import { createHmac } from "node:crypto";
import type { JobView } from "./jobs";
import type { Db } from "./postgres-repository";

/**
 * Webhooks for jobs an agent started over the API or MCP (review 15.10.2026: polling get_job does not scale). When a
 * job has finished, Tevyon posts it once to the caller's https address: `{ type: "job.finished", job }` in Tevyon's
 * own words (job type, model, status, credits, signed links, error code), never a vendor name. The request carries
 * `x-tevyon-signature: t=<seconds>,v1=<hex>`, an HMAC-SHA256 of "t.body" with the account's webhook secret, so a
 * receiver can check it and refuse old copies. A failed delivery is tried again after RETRY_MS, then given up.
 * Receivers should treat the job id as idempotency key: a delivery may arrive twice.
 */

/** Waits before the next try after a failed delivery: 1 min, 5 min, 30 min, 2 h, 6 h. */
export const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];

export type WebhookRow = {
  jobId: string;
  accountId: string;
  url: string;
  /** The origin the job was started at: links in the payload point there. */
  base: string;
  createdAt: number;
  attempts: number;
  nextAt: number;
  deliveredAt: number | null;
  failedAt: number | null;
  lastStatus: number | null;
};

export interface WebhookStore {
  /** Registers a job's webhook; a second one for the same job is ignored. */
  insert(row: WebhookRow): Promise<void>;
  /** Webhooks not yet delivered or given up whose next try is due, oldest first. */
  due(now: number, limit: number): Promise<WebhookRow[]>;
  record(jobId: string, change: Pick<WebhookRow, "attempts" | "nextAt" | "deliveredAt" | "failedAt" | "lastStatus">): Promise<void>;
}

export function createWebhooks(deps: {
  store: WebhookStore;
  /** The owner's view of a job (jobs.get): only the account's own jobs. */
  getJob: (accountId: string, jobId: string) => Promise<JobView | undefined>;
  /** The account's webhook secret. */
  secretFor: (accountId: string) => string;
  /** A media path as a link the receiver can open without a login (signed). */
  link: (url: string, base: string) => string;
  /** Posts the body; ok for a 2xx answer. The server's version refuses non-public addresses (SSRF). */
  send: (url: string, body: string, headers: Record<string, string>) => Promise<{ ok: boolean; status?: number }>;
  now?: () => number;
}) {
  const { store, now = Date.now } = deps;

  async function register(jobId: string, accountId: string, url: string, base: string): Promise<void> {
    const at = now();
    await store.insert({ jobId, accountId, url, base, createdAt: at, attempts: 0, nextAt: at, deliveredAt: null, failedAt: null, lastStatus: null });
  }

  function payload(job: JobView, base: string) {
    return {
      type: "job.finished",
      job: {
        id: job.id,
        job_type: job.jobType,
        model: job.model,
        status: job.status,
        credits: job.credits,
        outputs: job.outputs.map((o) => ({ url: deps.link(o.url, base), content_type: o.contentType })),
        ...(job.error ? { error: { code: job.error } } : {}),
        created_at: new Date(job.createdAt).toISOString(),
      },
      sent_at: new Date(now()).toISOString(),
    };
  }

  /** Delivers what is due: finished jobs only; a job still running stays registered and is looked at next time. */
  async function dispatch(limit = 50): Promise<{ sent: number }> {
    let sent = 0;
    for (const row of await store.due(now(), limit)) {
      const job = await deps.getJob(row.accountId, row.jobId);
      if (!job || (job.status !== "succeeded" && job.status !== "failed")) continue;
      const body = JSON.stringify(payload(job, row.base));
      const t = Math.floor(now() / 1000);
      const signature = createHmac("sha256", deps.secretFor(row.accountId)).update(`${t}.${body}`).digest("hex");
      const res = await deps.send(row.url, body, {
        "content-type": "application/json",
        "user-agent": "Tevyon-Webhook/1.0",
        "x-tevyon-event": "job.finished",
        "x-tevyon-delivery": `${row.jobId}.${row.attempts + 1}`,
        "x-tevyon-signature": `t=${t},v1=${signature}`,
      }).catch(() => ({ ok: false as const, status: undefined }));
      sent++;
      const attempts = row.attempts + 1;
      const lastStatus = res.status ?? null;
      if (res.ok) {
        await store.record(row.jobId, { attempts, nextAt: row.nextAt, deliveredAt: now(), failedAt: null, lastStatus });
      } else if (attempts > RETRY_MS.length) {
        await store.record(row.jobId, { attempts, nextAt: row.nextAt, deliveredAt: null, failedAt: now(), lastStatus });
      } else {
        await store.record(row.jobId, { attempts, nextAt: now() + RETRY_MS[attempts - 1]!, deliveredAt: null, failedAt: null, lastStatus });
      }
    }
    return { sent };
  }

  return { register, dispatch };
}

export type Webhooks = ReturnType<typeof createWebhooks>;

export function createMemoryWebhookStore(): WebhookStore {
  const rows = new Map<string, WebhookRow>();
  return {
    async insert(row) {
      if (!rows.has(row.jobId)) rows.set(row.jobId, { ...row });
    },
    async due(now, limit) {
      return [...rows.values()]
        .filter((r) => r.deliveredAt === null && r.failedAt === null && r.nextAt <= now)
        .sort((a, b) => a.nextAt - b.nextAt)
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async record(jobId, change) {
      const r = rows.get(jobId);
      if (r) rows.set(jobId, { ...r, ...change });
    },
  };
}

export function createPostgresWebhookStore(db: Db): WebhookStore {
  type Row = {
    job_id: string; account_id: string; url: string; base: string; created_at: Date; attempts: number; next_at: Date;
    delivered_at: Date | null; failed_at: Date | null; last_status: number | null;
  };
  const ms = (d: Date | null) => (d === null ? null : new Date(d).getTime());
  return {
    async insert(r) {
      await db.query(
        `insert into job_webhooks (job_id, account_id, url, base, created_at, attempts, next_at) values ($1, $2, $3, $4, $5, 0, $6)
         on conflict (job_id) do nothing`,
        [r.jobId, r.accountId, r.url, r.base, new Date(r.createdAt), new Date(r.nextAt)],
      );
    },
    async due(now, limit) {
      const rows = await db.query<Row>(
        `select * from job_webhooks where delivered_at is null and failed_at is null and next_at <= $1 order by next_at limit $2`,
        [new Date(now), limit],
      );
      return rows.map((r) => ({
        jobId: r.job_id, accountId: r.account_id, url: r.url, base: r.base, createdAt: ms(r.created_at)!, attempts: r.attempts,
        nextAt: ms(r.next_at)!, deliveredAt: ms(r.delivered_at), failedAt: ms(r.failed_at), lastStatus: r.last_status,
      }));
    },
    async record(jobId, c) {
      await db.query(
        `update job_webhooks set attempts = $2, next_at = $3, delivered_at = $4, failed_at = $5, last_status = $6 where job_id = $1`,
        [jobId, c.attempts, new Date(c.nextAt), c.deliveredAt === null ? null : new Date(c.deliveredAt), c.failedAt === null ? null : new Date(c.failedAt), c.lastStatus],
      );
    },
  };
}
