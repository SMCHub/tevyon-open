/**
 * Job repository port: jobs and credits live behind one interface, so that starting a job
 * (idempotency lookup + credit reservation + insert) is a single atomic step in every implementation.
 * Credits move in three steps: reserve on create, settle on succeed, release in full on fail.
 */
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** Tachyon's own failure codes. Raw provider messages never leave the core. */
export type JobFailure = "content_moderated" | "invalid_request" | "generation_failed" | "timed_out";

export type JobOutput = { url: string; contentType: string };

/** The channel that started a job: the Studio, the MCP server, the CLI or another API-key client. */
export type JobOrigin = "web" | "mcp" | "cli" | "api";

export type JobRecord = {
  id: string;
  accountId: string;
  jobType: string;
  model: string;
  status: JobStatus;
  credits: number;
  params: Record<string, unknown>;
  outputs: JobOutput[];
  error?: JobFailure;
  createdAt: number;
  /** Server-only: the provider's handle for a pending job. */
  handle?: string;
  /** Consecutive provider calls that threw (network, 5xx). */
  unreachable: number;
  /** Server-only: the parameters sent to the model, with the prompt written by the prompt skill. */
  providerParams?: Record<string, unknown>;
  /** name@version of the prompt skill that prepared the job. */
  promptSkill?: string;
  /** Server-only: what the finished job really cost at the provider, in USD, if the provider reported it. */
  costUsd?: number;
  /** Channel that started the job; "web" unless an API client says otherwise. */
  origin?: JobOrigin;
  /** The API key that started the job (MCP, CLI), so its owner can see what each key spent. */
  apiKeyId?: string;
};

export type NewJob = Pick<
  JobRecord, "id" | "accountId" | "jobType" | "model" | "credits" | "params" | "createdAt" | "providerParams" | "promptSkill" | "origin" | "apiKeyId"
>;

export type CreateResult =
  | { ok: true; job: JobRecord }
  | { ok: false; error: "insufficient_credits" }
  | { ok: false; error: "key_limit_reached"; limit: number; used: number };

/** Checks create() makes in the same atomic step as the reservation. */
export type CreateGuard = {
  /** The job's API key may spend at most `credits` on jobs created since `since` (reserved or charged, refunds excluded). */
  keyLimit?: { credits: number; since: number };
};

/**
 * One booked grant. Server-only: the ref may carry internal notes or payment IDs and never reaches a client.
 * Plan credits (Abo) carry `expiresAt` and what is left of them; bought and welcome credits never expire.
 */
export type GrantRecord = { ref: string; credits: number; createdAt: number; expiresAt?: number; remaining?: number };

/** The payment behind a purchase grant: refunds and disputes only name the payment (Stripe PaymentIntent). */
export type GrantPayment = { intent: string; /** Rappen */ amount: number };

/**
 * Plan credits expire with their period. Every spending path takes them first,
 * earliest expiry first; what is left at `expiresAt` lapses. Credits that go back (a failed job, a Director message that
 * cost less, a won dispute) return to their plan grant while it runs, afterwards they come back as normal credits.
 */
export type GrantOptions = { expiresAt?: number };

/**
 * Credits that leave an account outside of a job (credit_debits):
 * - director: a message with one of the strongest models, held at its cap while the turn runs, then settled to what
 *   the turn cost, or void (all back) if it never began
 * - refund, dispute: the credits of a purchase whose payment went back. Taken from what is available; the rest is
 *   owed and paid from the next grants first. A dispute that is won is void again.
 */
export type DebitKind = "director" | "refund" | "dispute";
export type DebitState = "held" | "settled" | "void";
export type DebitRecord = {
  ref: string;
  kind: DebitKind;
  state: DebitState;
  /** What is due. */
  credits: number;
  /** Taken from the balance so far; owed = credits − collected while settled. */
  collected: number;
  /** director: the public model name. */
  model?: string;
  createdAt: number;
  updatedAt: number;
};
export type NewDebit = {
  accountId: string; credits: number; ref: string; kind: DebitKind; model?: string;
  /** All or nothing (Director). */
  hold?: boolean;
  /** The API key or OAuth connection that spends (Director over MCP): counts against its daily limit like a job. */
  apiKeyId?: string;
  /** Checked in the same atomic step as the hold: the key may spend at most `credits` since `since`. */
  keyLimit?: { credits: number; since: number };
  /** A refunded plan invoice: take that plan grant's own credits first while its period runs. */
  preferGrant?: string;
  /**
   * A running total (refunds of one payment): `credits` is ignored; the debit takes what `total` still exceeds the
   * account's debits whose ref starts with `prefix`, counted in the same atomic step, so two at once never take too much.
   */
  upTo?: { prefix: string; total: number };
};
export type DebitResult =
  | { ok: true; collected: number; owed: number }
  | { ok: false; error: "insufficient_credits" }
  | { ok: false; error: "key_limit_reached"; limit: number; used: number };

export interface JobRepository {
  /** Adds credits once per ref (idempotent). Open debts (refund, dispute) are paid from them first. */
  grant(accountId: string, credits: number, ref: string, payment?: GrantPayment, opts?: GrantOptions): Promise<void>;
  /** The purchase grant a payment belongs to. */
  purchaseByPayment(intent: string): Promise<{ accountId: string; credits: number; amount: number; ref: string } | undefined>;
  /** Takes credits out once per ref: held all or nothing, otherwise as much as is available (the rest is owed). */
  debit(d: NewDebit): Promise<DebitResult>;
  /** Settles a held debit to what it really cost (at least 1, at most what was held); the rest goes back. */
  settleDebit(ref: string, credits: number): Promise<void>;
  /** Gives back what a debit took and cancels what is still owed. No-op once void. */
  voidDebit(ref: string): Promise<void>;
  /**
   * Gives back holds taken before `before` that never settled (a Director message whose process ended mid-stream),
   * for one account or all. Returns how many.
   */
  voidStaleHolds(before: number, accountId?: string): Promise<number>;
  /** The account's debits, oldest first. */
  debits(accountId: string): Promise<DebitRecord[]>;
  /** Credits the account still owes from refunds and disputes. */
  owed(accountId: string): Promise<number>;
  /** The account's grants, oldest first. */
  grants(accountId: string): Promise<GrantRecord[]>;
  /** Available credits: granted minus reserved minus spent, minus plan credits that lapsed. */
  balance(accountId: string): Promise<number>;
  /** Atomic: returns the existing job for a repeated idempotency key, else checks the guard, reserves credits and inserts. */
  create(job: NewJob, idempotencyKey?: string, guard?: CreateGuard): Promise<CreateResult>;
  /** Credits an API key holds or spent since `since` (ms), on jobs and Director messages; refunds do not count. */
  spentByKey(apiKeyId: string, since: number): Promise<number>;
  /** The job an account already started with this idempotency key, if any. Lets start() skip work for a retry. */
  findByKey(accountId: string, idempotencyKey: string): Promise<JobRecord | undefined>;
  get(jobId: string): Promise<JobRecord | undefined>;
  /** The account's jobs, newest first. */
  list(accountId: string): Promise<JobRecord[]>;
  /** Queued and running jobs, oldest first: the worker's to-do list. */
  active(): Promise<JobRecord[]>;
  /**
   * Claims these jobs for one worker until `until` (ms), unless another worker's claim is still running at `now`.
   * Claiming again renews a worker's own claim. Returns the jobs it got, freshly read and still active, so a worker
   * never advances a job another worker has or one that just finished.
   */
  claim(jobIds: string[], worker: string, now: number, until: number): Promise<JobRecord[]>;
  /**
   * Stores the prompt the skill wrote (with the other provider parameters) before the job goes to the vendor, so a
   * restarted worker sends the same prompt. Only while the job is queued and has none yet.
   */
  setPlan(jobId: string, providerParams: Record<string, unknown>, promptSkill: string): Promise<void>;
  markRunning(jobId: string, handle: string): Promise<void>;
  /** Counts a failed provider call and returns the new streak. */
  markUnreachable(jobId: string): Promise<number>;
  /** Stores outputs (and the provider's real cost, server-only) and settles the reserved credits. No-op unless the job is active. */
  succeed(jobId: string, outputs: JobOutput[], costUsd?: number): Promise<void>;
  /**
   * Marks the job failed and releases its credits in full. No-op unless the job is active. costUsd: what the provider
   * still charged for the failed job, if it said so (server-only, for the real cost).
   */
  fail(jobId: string, error: JobFailure, detail?: string, costUsd?: number): Promise<void>;
}

/**
 * How a spending path takes plan credits: «plan» spends them first (jobs, Director messages), «permanent» takes bought
 * credits first (a purchase that went back, an open debt) unless a refunded plan invoice names its own grant.
 */
export type AllocationOrder = { first: "plan" | "permanent"; prefer?: string };

export function createMemoryRepository(opts: { now?: () => number } = {}): JobRepository {
  const now = opts.now ?? Date.now;
  const grants = new Map<string, { accountId: string; credits: number; createdAt: number; payment?: GrantPayment; expiresAt?: number; remaining?: number }>();
  const debits = new Map<string, DebitRecord & { accountId: string; apiKeyId?: string }>();
  const holds = new Map<string, { accountId: string; credits: number; state: "reserved" | "settled" | "released" }>();
  /** Which plan grant paid how much of a job or debit (owner = job id or debit ref), so credits go back where they came from. */
  const uses = new Map<string, Map<string, number>>();
  const jobs = new Map<string, JobRecord>();
  const byKey = new Map<string, string>();
  /** Worker claims by job id (claim()). */
  const leases = new Map<string, { worker: string; until: number }>();

  const copy = (r: JobRecord): JobRecord => structuredClone(r);
  const isActive = (r: JobRecord | undefined): r is JobRecord => r?.status === "queued" || r?.status === "running";
  const running = (g: { expiresAt?: number }, at: number) => g.expiresAt !== undefined && g.expiresAt > at;

  /** Plan grants of the account that still run and have credits left, earliest expiry first. */
  function openPlans(accountId: string, at: number) {
    return [...grants].filter(([, g]) => g.accountId === accountId && running(g, at) && (g.remaining ?? 0) > 0)
      .sort(([ra, a], [rb, b]) => a.expiresAt! - b.expiresAt! || a.createdAt - b.createdAt || ra.localeCompare(rb));
  }

  // Synchronous on purpose: create() checks and reserves without an await in between,
  // so two simultaneous starts cannot both spend the same credits.
  function available(accountId: string, at = now()) {
    let total = 0;
    for (const g of grants.values()) {
      if (g.accountId !== accountId) continue;
      total += g.credits;
      // What was left of a plan grant at its end lapsed. That remainder never changes again (nothing returns to it).
      if (g.expiresAt !== undefined && g.expiresAt <= at) total -= g.remaining ?? 0;
    }
    for (const h of holds.values()) if (h.accountId === accountId && h.state !== "released") total -= h.credits;
    for (const d of debits.values()) if (d.accountId === accountId && d.state !== "void") total -= d.collected;
    return total;
  }

  /** Takes `credits` (at most what is available) for `owner` and books the plan part; the rest is bought credits. */
  function allocate(accountId: string, owner: string, credits: number, order: AllocationOrder) {
    const at = now();
    const plans = openPlans(accountId, at);
    const preferred = order.prefer ? plans.filter(([ref]) => ref === order.prefer) : [];
    const rest = plans.filter(([ref]) => ref !== order.prefer);
    let need = credits;
    if (order.first === "permanent") {
      const planCredits = plans.reduce((n, [, g]) => n + g.remaining!, 0);
      const fromPreferred = preferred.reduce((n, [, g]) => n + g.remaining!, 0);
      // Bought credits are what is available beyond the running plans.
      need -= Math.min(Math.max(0, need - fromPreferred), Math.max(0, available(accountId, at) - planCredits));
    }
    const mine = uses.get(owner) ?? new Map<string, number>();
    for (const [ref, g] of [...preferred, ...rest]) {
      if (need <= 0) break;
      const take = Math.min(need, g.remaining!);
      g.remaining! -= take;
      mine.set(ref, (mine.get(ref) ?? 0) + take);
      need -= take;
    }
    if (mine.size) uses.set(owner, mine);
  }

  /**
   * Gives up to `credits` of what `owner` took from plans back to them, in the reverse order they were taken (latest
   * expiry first), so what stays spent stays on the earliest plan. An ended plan keeps nothing.
   */
  function release(owner: string, credits = Infinity) {
    const mine = uses.get(owner);
    if (!mine) return;
    const at = now();
    const order = [...mine].sort(([ra], [rb]) => {
      const a = grants.get(ra)!;
      const b = grants.get(rb)!;
      return b.expiresAt! - a.expiresAt! || b.createdAt - a.createdAt || rb.localeCompare(ra);
    });
    let left = credits;
    for (const [ref, used] of order) {
      if (left <= 0) break;
      const back = Math.min(left, used);
      const g = grants.get(ref)!;
      if (running(g, at)) g.remaining! += back;
      if (back === used) mine.delete(ref);
      else mine.set(ref, used - back);
      left -= back;
    }
    if (!mine.size) uses.delete(owner);
  }

  const planUsed = (owner: string) => [...(uses.get(owner)?.values() ?? [])].reduce((n, c) => n + c, 0);

  /** Pays open debts (oldest first) from what is available, bought credits first. */
  function payOwed(accountId: string) {
    const open = [...debits.values()].filter((d) => d.accountId === accountId && d.state === "settled" && d.collected < d.credits);
    for (const d of open.sort((a, b) => a.createdAt - b.createdAt)) {
      const take = Math.min(available(accountId), d.credits - d.collected);
      if (take <= 0) break;
      allocate(accountId, d.ref, take, { first: "permanent" });
      d.collected += take;
      d.updatedAt = now();
    }
  }

  const debitView = ({ accountId: _accountId, apiKeyId: _apiKeyId, ...d }: DebitRecord & { accountId: string; apiKeyId?: string }): DebitRecord => ({ ...d });

  function spentSync(apiKeyId: string, since: number) {
    let total = 0;
    for (const r of jobs.values()) {
      if (r.apiKeyId === apiKeyId && r.createdAt >= since && holds.get(r.id)?.state !== "released") total += r.credits;
    }
    for (const d of debits.values()) {
      if (d.apiKeyId === apiKeyId && d.kind === "director" && d.createdAt >= since && d.state !== "void") total += d.credits;
    }
    return total;
  }

  return {
    async grant(accountId, credits, ref, payment, opts) {
      if (grants.has(ref)) return;
      grants.set(ref, {
        accountId, credits, createdAt: now(), ...(payment ? { payment: { ...payment } } : {}),
        ...(opts?.expiresAt !== undefined ? { expiresAt: opts.expiresAt, remaining: credits } : {}),
      });
      payOwed(accountId);
    },
    async purchaseByPayment(intent) {
      for (const [ref, g] of grants) {
        if (g.payment?.intent === intent) return { accountId: g.accountId, credits: g.credits, amount: g.payment.amount, ref };
      }
      return undefined;
    },
    async debit({ accountId, credits, ref, kind, model, hold, apiKeyId, keyLimit, preferGrant, upTo }) {
      if (upTo) {
        let already = 0;
        for (const d of debits.values()) if (d.accountId === accountId && d.state !== "void" && d.ref.startsWith(upTo.prefix)) already += d.credits;
        credits = upTo.total - already;
        if (credits <= 0) return { ok: true, collected: 0, owed: 0 };
      }
      const existing = debits.get(ref);
      if (existing) return { ok: true, collected: existing.collected, owed: existing.state === "settled" ? existing.credits - existing.collected : 0 };
      if (apiKeyId && keyLimit) {
        const used = spentSync(apiKeyId, keyLimit.since);
        if (used + credits > keyLimit.credits) return { ok: false, error: "key_limit_reached", limit: keyLimit.credits, used };
      }
      const free = Math.max(0, available(accountId));
      if (hold && free < credits) return { ok: false, error: "insufficient_credits" };
      const collected = hold ? credits : Math.min(free, credits);
      // A Director message spends like a job (plan first); a purchase that went back takes bought credits first.
      allocate(accountId, ref, collected, hold ? { first: "plan" } : { first: "permanent", ...(preferGrant ? { prefer: preferGrant } : {}) });
      const at = now();
      debits.set(ref, {
        ref, accountId, kind, state: hold ? "held" : "settled", credits, collected, ...(model ? { model } : {}), ...(apiKeyId ? { apiKeyId } : {}),
        createdAt: at, updatedAt: at,
      });
      return { ok: true, collected, owed: credits - collected };
    },
    async settleDebit(ref, credits) {
      const d = debits.get(ref);
      if (d?.state !== "held") return;
      const actual = Math.min(Math.max(Math.ceil(credits), 1), d.credits);
      // What it really cost stays on the plan as far as the plan paid; the difference goes back.
      release(ref, planUsed(ref) - Math.min(actual, planUsed(ref)));
      Object.assign(d, { credits: actual, collected: actual, state: "settled", updatedAt: now() });
    },
    async voidDebit(ref) {
      const d = debits.get(ref);
      if (!d || d.state === "void") return;
      release(ref);
      Object.assign(d, { state: "void", updatedAt: now() });
    },
    async voidStaleHolds(before, accountId) {
      let n = 0;
      for (const d of debits.values()) {
        if (d.state !== "held" || d.createdAt >= before || (accountId && d.accountId !== accountId)) continue;
        release(d.ref);
        Object.assign(d, { state: "void", updatedAt: now() });
        n++;
      }
      return n;
    },
    async debits(accountId) {
      return [...debits.values()].filter((d) => d.accountId === accountId).sort((a, b) => a.createdAt - b.createdAt).map(debitView);
    },
    async owed(accountId) {
      let total = 0;
      for (const d of debits.values()) if (d.accountId === accountId && d.state === "settled") total += d.credits - d.collected;
      return total;
    },
    async grants(accountId) {
      return [...grants].filter(([, g]) => g.accountId === accountId).map(([ref, g]) => ({
        ref, credits: g.credits, createdAt: g.createdAt,
        ...(g.expiresAt !== undefined ? { expiresAt: g.expiresAt, remaining: g.remaining! } : {}),
      }));
    },
    async balance(accountId) {
      return available(accountId);
    },
    async create(job, idempotencyKey, guard) {
      const keyRef = idempotencyKey && `${job.accountId}:${idempotencyKey}`;
      const existing = keyRef ? jobs.get(byKey.get(keyRef) ?? "") : undefined;
      if (existing) return { ok: true, job: copy(existing) };
      const limit = guard?.keyLimit;
      if (limit && job.apiKeyId) {
        const used = spentSync(job.apiKeyId, limit.since);
        if (used + job.credits > limit.credits) return { ok: false, error: "key_limit_reached", limit: limit.credits, used };
      }
      if (available(job.accountId) < job.credits) return { ok: false, error: "insufficient_credits" };
      allocate(job.accountId, job.id, job.credits, { first: "plan" });
      holds.set(job.id, { accountId: job.accountId, credits: job.credits, state: "reserved" });
      const record: JobRecord = { ...job, origin: job.origin ?? "web", status: "queued", outputs: [], unreachable: 0 };
      jobs.set(job.id, record);
      if (keyRef) byKey.set(keyRef, job.id);
      return { ok: true, job: copy(record) };
    },
    async spentByKey(apiKeyId, since) {
      return spentSync(apiKeyId, since);
    },
    async findByKey(accountId, idempotencyKey) {
      const r = jobs.get(byKey.get(`${accountId}:${idempotencyKey}`) ?? "");
      return r && copy(r);
    },
    async get(jobId) {
      const r = jobs.get(jobId);
      return r && copy(r);
    },
    async list(accountId) {
      return [...jobs.values()].filter((r) => r.accountId === accountId).reverse().map(copy);
    },
    async active() {
      return [...jobs.values()].filter(isActive).map(copy);
    },
    async claim(jobIds, worker, now, until) {
      const got: JobRecord[] = [];
      for (const id of jobIds) {
        const r = jobs.get(id);
        const lease = leases.get(id);
        if (!isActive(r) || (lease && lease.worker !== worker && lease.until > now)) continue;
        leases.set(id, { worker, until });
        got.push(copy(r));
      }
      return got;
    },
    async setPlan(jobId, providerParams, promptSkill) {
      const r = jobs.get(jobId);
      if (r?.status !== "queued" || r.providerParams) return;
      r.providerParams = structuredClone(providerParams);
      r.promptSkill = promptSkill;
    },
    async markRunning(jobId, handle) {
      const r = jobs.get(jobId);
      if (!isActive(r)) return;
      r.status = "running";
      r.handle = handle;
      r.unreachable = 0;
    },
    async markUnreachable(jobId) {
      const r = jobs.get(jobId);
      if (!r) return 0;
      return ++r.unreachable;
    },
    async succeed(jobId, outputs, costUsd) {
      const r = jobs.get(jobId);
      if (!isActive(r)) return;
      r.status = "succeeded";
      r.outputs = outputs;
      if (costUsd !== undefined) r.costUsd = costUsd;
      const h = holds.get(jobId);
      if (h?.state === "reserved") h.state = "settled";
    },
    async fail(jobId, error, _detail, costUsd) {
      const r = jobs.get(jobId);
      if (!isActive(r)) return;
      r.status = "failed";
      r.error = error;
      if (costUsd !== undefined) r.costUsd = costUsd;
      const h = holds.get(jobId);
      if (h?.state === "reserved") {
        h.state = "released";
        release(jobId);
      }
    },
  };
}
