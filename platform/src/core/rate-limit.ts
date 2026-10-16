import type { Db } from "./postgres-repository";

/**
 * Fixed-window rate limits per bucket (e.g. "oauth.register:addr:203.0.113.7"). A hit counts one request; the first
 * hit after a window ended opens a new one. On Postgres one upsert counts, so the limit holds across server instances
 * (migration 0013). Framework-free; which requests count where is the server's business (src/server/oauth-limits.ts).
 */
export type RateRule = { limit: number; windowMs: number };
export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export type RateLimiter = {
  hit(bucket: string, rule: RateRule): Promise<RateLimitResult>;
  /** Removes the counters whose window ended (cleanup cron). Returns how many. */
  purge(): Promise<number>;
};

function judge(count: number, resetAt: number, rule: RateRule, now: number): RateLimitResult {
  if (count <= rule.limit) return { ok: true, remaining: rule.limit - count };
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
}

export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const counters = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(bucket, rule) {
      const t = now();
      const c = counters.get(bucket);
      const next = !c || c.resetAt <= t ? { count: 1, resetAt: t + rule.windowMs } : { count: c.count + 1, resetAt: c.resetAt };
      counters.set(bucket, next);
      return judge(next.count, next.resetAt, rule, t);
    },
    async purge() {
      const t = now();
      let n = 0;
      for (const [bucket, c] of counters) {
        if (c.resetAt <= t) {
          counters.delete(bucket);
          n++;
        }
      }
      return n;
    },
  };
}

const HIT = `insert into rate_limits (bucket, count, reset_at) values ($1, 1, $2)
  on conflict (bucket) do update set
    count = case when rate_limits.reset_at <= $3 then 1 else rate_limits.count + 1 end,
    reset_at = case when rate_limits.reset_at <= $3 then excluded.reset_at else rate_limits.reset_at end
  returning count, reset_at`;

export function createPostgresRateLimiter(db: Db, now: () => number = Date.now): RateLimiter {
  return {
    async hit(bucket, rule) {
      const t = now();
      const [row] = await db.query<{ count: number; reset_at: Date | string }>(HIT, [bucket, new Date(t + rule.windowMs), new Date(t)]);
      return judge(Number(row!.count), new Date(row!.reset_at).getTime(), rule, t);
    },
    async purge() {
      const rows = await db.query<{ bucket: string }>("delete from rate_limits where reset_at <= $1 returning bucket", [new Date(now())]);
      return rows.length;
    },
  };
}
