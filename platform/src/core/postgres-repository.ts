import type { AllocationOrder, CreateResult, DebitRecord, DebitResult, JobFailure, JobOutput, JobRecord, JobRepository } from "./repository";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minimal SQL access so the same repository runs on node-postgres and on PGlite in tests. */
export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
export type Db = { query: Query; tx<T>(fn: (q: Query) => Promise<T>): Promise<T> };

type Row = {
  id: string;
  account_id: string;
  job_type: string;
  model: string;
  status: JobRecord["status"];
  credits: number;
  params: Record<string, unknown>;
  outputs: JobOutput[];
  error: JobFailure | null;
  created_at: Date | string;
  provider_handle: string | null;
  unreachable: number;
  provider_params: Record<string, unknown> | null;
  prompt_skill: string | null;
  /** numeric comes back as a string from node-postgres. */
  cost_usd: string | number | null;
  origin: NonNullable<JobRecord["origin"]>;
  api_key_id: string | null;
};

const COLS =
  "id, account_id, job_type, model, status, credits, params, outputs, error, created_at, provider_handle, unreachable, provider_params, prompt_skill, cost_usd, origin, api_key_id";
const ACTIVE = "status in ('queued', 'running')";

function toRecord(r: Row): JobRecord {
  const rec: JobRecord = {
    id: r.id, accountId: r.account_id, jobType: r.job_type, model: r.model, status: r.status, credits: r.credits,
    params: r.params, outputs: r.outputs, createdAt: new Date(r.created_at).getTime(), unreachable: r.unreachable, origin: r.origin,
  };
  if (r.error) rec.error = r.error;
  if (r.provider_handle) rec.handle = r.provider_handle;
  if (r.provider_params) rec.providerParams = r.provider_params;
  if (r.prompt_skill) rec.promptSkill = r.prompt_skill;
  if (r.cost_usd !== null) rec.costUsd = Number(r.cost_usd);
  if (r.api_key_id) rec.apiKeyId = r.api_key_id;
  return rec;
}

class Rollback extends Error {}

class KeyLimit extends Error {
  constructor(readonly limit: number, readonly used: number) {
    super("key_limit_reached");
  }
}

/** What an API key holds or spent on jobs since a point in time; refunded jobs do not count. */
const SPENT_BY_KEY = `select coalesce(sum(credits), 0) as used from jobs
  where api_key_id = $1 and created_at >= $2 and credit_state in ('reserved', 'settled')`;
/** The same for Director messages the key paid (held or settled; void ones gave everything back). */
const DEBITED_BY_KEY = `select coalesce(sum(credits), 0) as used from credit_debits
  where api_key_id = $1 and created_at >= $2 and kind = 'director' and state <> 'void'`;

type DebitRow = {
  ref: string; account_id: string; kind: DebitRecord["kind"]; state: DebitRecord["state"]; credits: number; collected: number;
  model: string | null; created_at: Date | string; updated_at: Date | string;
};

const toDebit = (r: DebitRow): DebitRecord => ({
  ref: r.ref, kind: r.kind, state: r.state, credits: r.credits, collected: r.collected, ...(r.model ? { model: r.model } : {}),
  createdAt: new Date(r.created_at).getTime(), updatedAt: new Date(r.updated_at).getTime(),
});

/** Locks the account's credit row (created empty if missing). Every credit movement takes this lock first. */
async function lockAccount(q: Query, accountId: string): Promise<number> {
  await q("insert into credit_accounts (account_id, balance) values ($1, 0) on conflict (account_id) do nothing", [accountId]);
  const rows = await q<{ balance: number }>("select balance from credit_accounts where account_id = $1 for update", [accountId]);
  return rows[0]!.balance;
}

/** What was left of the account's ended plan grants: it lapsed, but credit_accounts.balance still counts it. */
const LAPSED = "select coalesce(sum(remaining), 0) as lapsed from credit_grants where account_id = $1 and expires_at <= $2";

async function lapsed(q: Query, accountId: string, at: Date): Promise<number> {
  const rows = await q<{ lapsed: string | number }>(LAPSED, [accountId, at]);
  return Number(rows[0]?.lapsed ?? 0);
}

/**
 * Under the account lock: takes `credits` for `owner` (a job id or a debit ref) and books the part that running plan
 * grants pay, earliest expiry first (repository.ts «AllocationOrder»). `available` is what the account had before.
 */
async function allocate(q: Query, accountId: string, owner: string, credits: number, available: number, order: AllocationOrder, at: Date) {
  if (credits <= 0) return;
  const plans = await q<{ ref: string; remaining: number }>(
    "select ref, remaining from credit_grants where account_id = $1 and expires_at > $2 and remaining > 0 order by expires_at, created_at, ref for update",
    [accountId, at],
  );
  const preferred = order.prefer ? plans.filter((p) => p.ref === order.prefer) : [];
  const rest = plans.filter((p) => p.ref !== order.prefer);
  let need = credits;
  if (order.first === "permanent") {
    const planCredits = plans.reduce((n, p) => n + p.remaining, 0);
    const fromPreferred = preferred.reduce((n, p) => n + p.remaining, 0);
    need -= Math.min(Math.max(0, need - fromPreferred), Math.max(0, available - planCredits));
  }
  for (const p of [...preferred, ...rest]) {
    if (need <= 0) break;
    const take = Math.min(need, p.remaining);
    await q("update credit_grants set remaining = remaining - $2 where ref = $1", [p.ref, take]);
    await q(
      "insert into credit_uses (owner, grant_ref, credits) values ($1, $2, $3) on conflict (owner, grant_ref) do update set credits = credit_uses.credits + excluded.credits",
      [owner, p.ref, take],
    );
    need -= take;
  }
}

/**
 * Under the account lock: gives up to `credits` of what `owner` took from plans back, in the reverse order allocate()
 * took them, so what stays spent stays on the earliest plan. An ended plan keeps nothing.
 */
async function release(q: Query, owner: string, at: Date, credits = Number.POSITIVE_INFINITY) {
  const rows = await q<{ grant_ref: string; credits: number; expires_at: Date | string }>(
    `select u.grant_ref, u.credits, g.expires_at from credit_uses u join credit_grants g on g.ref = u.grant_ref
     where u.owner = $1 order by g.expires_at desc, g.created_at desc, u.grant_ref desc for update of u`,
    [owner],
  );
  let left = credits;
  for (const r of rows) {
    if (left <= 0) break;
    const back = Math.min(left, r.credits);
    if (new Date(r.expires_at).getTime() > at.getTime()) await q("update credit_grants set remaining = remaining + $2 where ref = $1", [r.grant_ref, back]);
    if (back === r.credits) await q("delete from credit_uses where owner = $1 and grant_ref = $2", [owner, r.grant_ref]);
    else await q("update credit_uses set credits = credits - $3 where owner = $1 and grant_ref = $2", [owner, r.grant_ref, back]);
    left -= back;
  }
}

async function planUsed(q: Query, owner: string): Promise<number> {
  const rows = await q<{ used: string | number }>("select coalesce(sum(credits), 0) as used from credit_uses where owner = $1", [owner]);
  return Number(rows[0]?.used ?? 0);
}

export function createPostgresRepository(db: Db, opts: { now?: () => number } = {}): JobRepository {
  /** Every expiry comparison uses this clock, never SQL now(): one clock in production, a settable one in tests. */
  const clock = () => new Date((opts.now ?? Date.now)());
  /** A debit's account, then the account lock, then the debit row: the same lock order as every other movement. */
  async function withDebit(ref: string, fn: (q: Query, d: DebitRow) => Promise<void>) {
    const found = await db.query<{ account_id: string }>("select account_id from credit_debits where ref = $1", [ref]);
    if (!found[0]) return;
    await db.tx(async (q) => {
      await lockAccount(q, found[0]!.account_id);
      const rows = await q<DebitRow>("select * from credit_debits where ref = $1 for update", [ref]);
      if (rows[0]) await fn(q, rows[0]);
    });
  }

  return {
    async grant(accountId, credits, ref, payment, opts) {
      await db.tx(async (q) => {
        const at = clock();
        const expiresAt = opts?.expiresAt !== undefined ? new Date(opts.expiresAt) : null;
        const inserted = await q(
          `insert into credit_grants (ref, account_id, credits, payment_intent, amount_rappen, expires_at, remaining, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing returning ref`,
          [ref, accountId, credits, payment?.intent ?? null, payment?.amount ?? null, expiresAt, expiresAt ? credits : null, at],
        );
        if (inserted.length === 0) return;
        let balance = (await lockAccount(q, accountId)) + credits;
        let free = balance - (await lapsed(q, accountId, at));
        // Open debts (refund, dispute) are paid first, oldest first, from bought credits before plan credits.
        const open = await q<{ ref: string; due: number }>(
          "select ref, credits - collected as due from credit_debits where account_id = $1 and state = 'settled' and collected < credits order by created_at, ref for update",
          [accountId],
        );
        for (const d of open) {
          const take = Math.min(free, d.due);
          if (take <= 0) break;
          await allocate(q, accountId, d.ref, take, free, { first: "permanent" }, at);
          await q("update credit_debits set collected = collected + $2, updated_at = now() where ref = $1", [d.ref, take]);
          balance -= take;
          free -= take;
        }
        await q("update credit_accounts set balance = $2 where account_id = $1", [accountId, balance]);
      });
    },

    async purchaseByPayment(intent) {
      const rows = await db.query<{ ref: string; account_id: string; credits: number; amount_rappen: number }>(
        "select ref, account_id, credits, amount_rappen from credit_grants where payment_intent = $1",
        [intent],
      );
      const r = rows[0];
      return r ? { accountId: r.account_id, credits: r.credits, amount: r.amount_rappen, ref: r.ref } : undefined;
    },

    async debit({ accountId, credits, ref, kind, model, hold, apiKeyId, keyLimit, preferGrant, upTo }): Promise<DebitResult> {
      return db.tx(async (q) => {
        const at = clock();
        const balance = (await lockAccount(q, accountId)) - (await lapsed(q, accountId, at));
        if (upTo) {
          // Under the account lock: a second debit of the same running total waits and then sees this one.
          const [row] = await q<{ already: string | number }>(
            "select coalesce(sum(credits), 0) as already from credit_debits where account_id = $1 and state <> 'void' and left(ref, length($2)) = $2",
            [accountId, upTo.prefix],
          );
          credits = upTo.total - Number(row?.already ?? 0);
          if (credits <= 0) return { ok: true, collected: 0, owed: 0 };
        }
        const existing = await q<DebitRow>("select * from credit_debits where ref = $1", [ref]);
        if (existing[0]) {
          const d = existing[0];
          return { ok: true, collected: d.collected, owed: d.state === "settled" ? d.credits - d.collected : 0 };
        }
        if (apiKeyId && keyLimit) {
          // The account lock above serialises this with the key's job starts (create() takes the same lock).
          const since = new Date(keyLimit.since);
          const [jobs, debited] = [await q<{ used: string | number }>(SPENT_BY_KEY, [apiKeyId, since]), await q<{ used: string | number }>(DEBITED_BY_KEY, [apiKeyId, since])];
          const used = Number(jobs[0]?.used ?? 0) + Number(debited[0]?.used ?? 0);
          if (used + credits > keyLimit.credits) return { ok: false, error: "key_limit_reached", limit: keyLimit.credits, used };
        }
        if (hold && balance < credits) return { ok: false, error: "insufficient_credits" };
        const collected = hold ? credits : Math.min(Math.max(0, balance), credits);
        // A Director message spends like a job (plan first); a purchase that went back takes bought credits first.
        await allocate(q, accountId, ref, collected, balance, hold ? { first: "plan" } : { first: "permanent", ...(preferGrant ? { prefer: preferGrant } : {}) }, at);
        await q("update credit_accounts set balance = balance - $2 where account_id = $1", [accountId, collected]);
        await q(
          "insert into credit_debits (ref, account_id, kind, state, credits, collected, model, api_key_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
          [ref, accountId, kind, hold ? "held" : "settled", credits, collected, model ?? null, apiKeyId ?? null],
        );
        return { ok: true, collected, owed: credits - collected };
      });
    },

    async settleDebit(ref, credits) {
      await withDebit(ref, async (q, d) => {
        if (d.state !== "held") return;
        const actual = Math.min(Math.max(Math.ceil(credits), 1), d.credits);
        // What it really cost stays on the plan as far as the plan paid; the difference goes back.
        const used = await planUsed(q, ref);
        await release(q, ref, clock(), used - Math.min(actual, used));
        await q("update credit_accounts set balance = balance + $2 where account_id = $1", [d.account_id, d.credits - actual]);
        await q("update credit_debits set credits = $2, collected = $2, state = 'settled', updated_at = now() where ref = $1", [ref, actual]);
      });
    },

    async voidDebit(ref) {
      await withDebit(ref, async (q, d) => {
        if (d.state === "void") return;
        await release(q, ref, clock());
        await q("update credit_accounts set balance = balance + $2 where account_id = $1", [d.account_id, d.collected]);
        await q("update credit_debits set state = 'void', updated_at = now() where ref = $1", [ref]);
      });
    },

    async voidStaleHolds(before, accountId) {
      const stale = await db.query<{ ref: string }>(
        "select ref from credit_debits where state = 'held' and created_at < $1 and ($2::uuid is null or account_id = $2::uuid)",
        [new Date(before), accountId ?? null],
      );
      let n = 0;
      for (const { ref } of stale) {
        // Under the lock again: a message that settled meanwhile keeps its booking.
        await withDebit(ref, async (q, d) => {
          if (d.state !== "held") return;
          await release(q, ref, clock());
          await q("update credit_accounts set balance = balance + $2 where account_id = $1", [d.account_id, d.collected]);
          await q("update credit_debits set state = 'void', updated_at = now() where ref = $1", [ref]);
          n++;
        });
      }
      return n;
    },

    async debits(accountId) {
      const rows = await db.query<DebitRow>("select * from credit_debits where account_id = $1 order by created_at, ref", [accountId]);
      return rows.map(toDebit);
    },

    async owed(accountId) {
      const rows = await db.query<{ owed: string | number }>(
        "select coalesce(sum(credits - collected), 0) as owed from credit_debits where account_id = $1 and state = 'settled'",
        [accountId],
      );
      return Number(rows[0]?.owed ?? 0);
    },

    async grants(accountId) {
      const rows = await db.query<{ ref: string; credits: number; created_at: Date | string; expires_at: Date | string | null; remaining: number | null }>(
        "select ref, credits, created_at, expires_at, remaining from credit_grants where account_id = $1 order by created_at, ref",
        [accountId],
      );
      return rows.map((r) => ({
        ref: r.ref, credits: r.credits, createdAt: new Date(r.created_at).getTime(),
        ...(r.expires_at !== null ? { expiresAt: new Date(r.expires_at).getTime(), remaining: r.remaining ?? 0 } : {}),
      }));
    },

    async balance(accountId) {
      const rows = await db.query<{ balance: number | string }>(
        `select a.balance - (${LAPSED.replace("$1", "a.account_id")}) as balance from credit_accounts a where a.account_id = $1`,
        [accountId, clock()],
      );
      return Number(rows[0]?.balance ?? 0);
    },

    async create(job, idempotencyKey, guard): Promise<CreateResult> {
      try {
        return await db.tx(async (q) => {
          const inserted = await q<Row>(
            `insert into jobs (id, account_id, job_type, model, status, credits, params, idempotency_key, created_at, provider_params, prompt_skill, origin, api_key_id)
             values ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10, $11, $12)
             on conflict (account_id, idempotency_key) do nothing returning ${COLS}`,
            [
              job.id, job.accountId, job.jobType, job.model, job.credits, JSON.stringify(job.params), idempotencyKey ?? null, new Date(job.createdAt),
              job.providerParams ? JSON.stringify(job.providerParams) : null, job.promptSkill ?? null, job.origin ?? "web", job.apiKeyId ?? null,
            ],
          );
          if (inserted.length === 0) {
            const existing = await q<Row>(`select ${COLS} from jobs where account_id = $1 and idempotency_key = $2`, [job.accountId, idempotencyKey]);
            return { ok: true as const, job: toRecord(existing[0]!) };
          }
          // Lock the account row first: parallel starts of the same account queue up here, so the sums below already
          // see every job a parallel start has committed. A missing row is created empty and rolled back with the start.
          const at = clock();
          const balance = (await lockAccount(q, job.accountId)) - (await lapsed(q, job.accountId, at));
          const limit = guard?.keyLimit;
          if (limit && job.apiKeyId) {
            const rows = await q<{ used: string | number }>(`${SPENT_BY_KEY} and id <> $3`, [job.apiKeyId, new Date(limit.since), job.id]);
            const debited = await q<{ used: string | number }>(DEBITED_BY_KEY, [job.apiKeyId, new Date(limit.since)]);
            const used = Number(rows[0]?.used ?? 0) + Number(debited[0]?.used ?? 0);
            if (used + job.credits > limit.credits) throw new KeyLimit(limit.credits, used);
          }
          // Lapsed plan credits are not available, even though credit_accounts.balance still counts them.
          if (balance < job.credits) throw new Rollback();
          await allocate(q, job.accountId, job.id, job.credits, balance, { first: "plan" }, at);
          await q("update credit_accounts set balance = balance - $2 where account_id = $1", [job.accountId, job.credits]);
          return { ok: true as const, job: toRecord(inserted[0]!) };
        });
      } catch (e) {
        if (e instanceof Rollback) return { ok: false, error: "insufficient_credits" };
        if (e instanceof KeyLimit) return { ok: false, error: "key_limit_reached", limit: e.limit, used: e.used };
        throw e;
      }
    },

    async spentByKey(apiKeyId, since) {
      const [jobs, debited] = await Promise.all([
        db.query<{ used: string | number }>(SPENT_BY_KEY, [apiKeyId, new Date(since)]),
        db.query<{ used: string | number }>(DEBITED_BY_KEY, [apiKeyId, new Date(since)]),
      ]);
      return Number(jobs[0]?.used ?? 0) + Number(debited[0]?.used ?? 0);
    },

    async findByKey(accountId, idempotencyKey) {
      const rows = await db.query<Row>(`select ${COLS} from jobs where account_id = $1 and idempotency_key = $2`, [accountId, idempotencyKey]);
      return rows[0] && toRecord(rows[0]);
    },

    async get(jobId) {
      // Ids come from URLs (media paths, API calls): one that is no uuid names no job, and must not fail the cast.
      if (!JOB_ID.test(jobId)) return undefined;
      const rows = await db.query<Row>(`select ${COLS} from jobs where id = $1`, [jobId]);
      return rows[0] && toRecord(rows[0]);
    },

    async list(accountId) {
      const rows = await db.query<Row>(`select ${COLS} from jobs where account_id = $1 order by created_at desc, id desc`, [accountId]);
      return rows.map(toRecord);
    },

    async active() {
      const rows = await db.query<Row>(`select ${COLS} from jobs where ${ACTIVE} order by created_at, id`);
      return rows.map(toRecord);
    },

    async claim(jobIds, worker, now, until) {
      if (jobIds.length === 0) return [];
      // One statement: the row lock makes two workers claiming the same job take turns, and only one gets it.
      const rows = await db.query<Row>(
        `update jobs set lease_owner = $2, lease_until = $4
         where id = any($1::uuid[]) and ${ACTIVE} and (lease_until is null or lease_until <= $3 or lease_owner = $2)
         returning ${COLS}`,
        [jobIds, worker, new Date(now), new Date(until)],
      );
      return rows.map(toRecord);
    },

    async setPlan(jobId, providerParams, promptSkill) {
      await db.query(
        "update jobs set provider_params = $2, prompt_skill = $3, updated_at = now() where id = $1 and status = 'queued' and provider_params is null",
        [jobId, JSON.stringify(providerParams), promptSkill],
      );
    },

    async markRunning(jobId, handle) {
      await db.query(`update jobs set status = 'running', provider_handle = $2, unreachable = 0, updated_at = now() where id = $1 and ${ACTIVE}`, [jobId, handle]);
    },

    async markUnreachable(jobId) {
      const rows = await db.query<{ unreachable: number }>("update jobs set unreachable = unreachable + 1, updated_at = now() where id = $1 returning unreachable", [jobId]);
      return rows[0]?.unreachable ?? 0;
    },

    async succeed(jobId, outputs, costUsd) {
      await db.query(
        `update jobs set status = 'succeeded', outputs = $2, cost_usd = $3, credit_state = 'settled', updated_at = now() where id = $1 and ${ACTIVE}`,
        [jobId, JSON.stringify(outputs), costUsd ?? null],
      );
    },

    async fail(jobId, error, detail, costUsd) {
      await db.tx(async (q) => {
        const rows = await q<{ account_id: string; credits: number }>(
          `update jobs set status = 'failed', error = $2, provider_detail = $3, cost_usd = $4, credit_state = 'released', updated_at = now()
           where id = $1 and ${ACTIVE} and credit_state = 'reserved' returning account_id, credits`,
          [jobId, error, detail ?? null, costUsd ?? null],
        );
        const r = rows[0];
        if (!r) return;
        // The account lock before the plan grants, like every other movement. After its plan ended, they come back as normal credits.
        await lockAccount(q, r.account_id);
        await release(q, jobId, clock());
        await q("update credit_accounts set balance = balance + $2 where account_id = $1", [r.account_id, r.credits]);
      });
    },
  };
}
