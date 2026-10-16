import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter, createPostgresRateLimiter, type RateLimiter } from "./rate-limit";
import { pgliteDb } from "./testing/repositories";

const RULE = { limit: 3, windowMs: 60_000 };

const limiters: [string, (now: () => number) => Promise<RateLimiter>][] = [
  ["memory", async (now) => createMemoryRateLimiter(now)],
  ["postgres", async (now) => createPostgresRateLimiter(await pgliteDb(), now)],
];

describe.each(limiters)("rate limits (%s)", (_name, make) => {
  it("lets requests through up to the limit, then says how long to wait", async () => {
    let t = Date.UTC(2026, 9, 13, 20);
    const limiter = await make(() => t);
    expect(await limiter.hit("a", RULE)).toEqual({ ok: true, remaining: 2 });
    expect(await limiter.hit("a", RULE)).toEqual({ ok: true, remaining: 1 });
    expect(await limiter.hit("a", RULE)).toEqual({ ok: true, remaining: 0 });
    expect(await limiter.hit("a", RULE)).toEqual({ ok: false, retryAfterSeconds: 60 });
    t += 30_000;
    expect(await limiter.hit("a", RULE)).toEqual({ ok: false, retryAfterSeconds: 30 });
  });

  it("starts a new window once the old one ended", async () => {
    let t = Date.UTC(2026, 9, 13, 20);
    const limiter = await make(() => t);
    for (let i = 0; i < 4; i++) await limiter.hit("a", RULE);
    t += 60_000;
    expect(await limiter.hit("a", RULE)).toEqual({ ok: true, remaining: 2 });
  });

  it("counts every bucket on its own", async () => {
    const t = Date.UTC(2026, 9, 13, 20);
    const limiter = await make(() => t);
    for (let i = 0; i < 3; i++) await limiter.hit("a", RULE);
    expect(await limiter.hit("b", RULE)).toEqual({ ok: true, remaining: 2 });
    expect((await limiter.hit("a", RULE)).ok).toBe(false);
  });

  it("purges only counters whose window ended", async () => {
    let t = Date.UTC(2026, 9, 13, 20);
    const limiter = await make(() => t);
    await limiter.hit("old", { limit: 5, windowMs: 1000 });
    await limiter.hit("live", { limit: 5, windowMs: 3_600_000 });
    t += 2000;
    expect(await limiter.purge()).toBe(1);
    expect(await limiter.hit("live", { limit: 5, windowMs: 3_600_000 })).toEqual({ ok: true, remaining: 3 });
  });

  it("counts requests that arrive at the same time exactly once each", async () => {
    const t = Date.UTC(2026, 9, 13, 20);
    const limiter = await make(() => t);
    const results = await Promise.all(Array.from({ length: 6 }, () => limiter.hit("burst", RULE)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });
});
