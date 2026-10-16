import { createMemoryRateLimiter, createPostgresRateLimiter, type RateLimiter } from "@/core/rate-limit";
import { createPgDb } from "./db";

// Its own module on purpose: a new export on keys.ts was not picked up by the running dev server (stale module).
const g = globalThis as unknown as { __tachyonRateLimiter?: RateLimiter };

/** Rate limits for open endpoints (OAuth registration and device login), counted in the database across instances. */
export function rateLimiter(): RateLimiter {
  const url = process.env.DATABASE_URL;
  return (g.__tachyonRateLimiter ??= url ? createPostgresRateLimiter(createPgDb(url)) : createMemoryRateLimiter());
}
