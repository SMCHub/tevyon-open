import { comfyKey } from "@/server/comfy";
import { hasPaid } from "@/core/credits";
import { createDirectorBudget, createMemoryDirectorUsage, createPostgresDirectorUsage, type DirectorUsageStore } from "@/core/director-usage";
import { createPgDb } from "./db";
import { createDirectorService } from "./director";
import { createDirectorModel } from "./director-llm";
import { visionDataUrl } from "./director-photo";
import { createNetworkLimits } from "./network-limits";
import { rateLimiter } from "./rate-limits";
import { runtime } from "./runtime";

/**
 * Free Director budget in USD per account and rolling 24 hours: 0.05 until the first purchase (DIRECTOR_FREE_DAILY_USD),
 * 0.25 after it (DIRECTOR_DAILY_USD), nothing while the account owes credits from a refund or dispute.
 */
function usd(name: string, fallback: number): number {
  const raw = process.env[name];
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Without a database the spending is kept in memory; it has to survive hot reloads like the runtime. */
const g = globalThis as unknown as { __tachyonDirectorUsage?: DirectorUsageStore };

let wired: Promise<{ budget: ReturnType<typeof createDirectorBudget>; service: ReturnType<typeof createDirectorService> }> | undefined;

/** The Director wired to the runtime: provider key, quotes, the caller's uploads and the daily budget. */
export function director() {
  wired ??= (async () => {
    const rt = await runtime();
    const url = process.env.DATABASE_URL;
    const store = url ? createPostgresDirectorUsage(createPgDb(url)) : (g.__tachyonDirectorUsage ??= createMemoryDirectorUsage());
    const standing = async (accountId: string) => {
      const [grants, debits, owed] = await Promise.all([rt.repo.grants(accountId), rt.repo.debits(accountId), rt.repo.owed(accountId)]);
      return { paying: hasPaid(grants, debits), owed };
    };
    const [free, paying] = [usd("DIRECTOR_FREE_DAILY_USD", 0.05), usd("DIRECTOR_DAILY_USD", 0.25)];
    const budget = createDirectorBudget({
      store,
      dailyUsd: async (accountId) => {
        const s = await standing(accountId);
        return s.owed > 0 ? 0 : s.paying ? paying : free;
      },
    });
    const key = comfyKey();
    const service = createDirectorService({
      standing,
      ledger: rt.repo,
      balance: (accountId) => rt.repo.balance(accountId),
      model: (def) => (key ? createDirectorModel({ apiKey: key, model: def }) : null),
      budget,
      quote: (jobType, params) => {
        const q = rt.jobs.quote(jobType, params);
        return q.ok ? q.credits : null;
      },
      photo: async (path) => {
        const file = await rt.media.read(path.replace(/^\/api\/media\//, ""));
        return file ? visionDataUrl(file.data) : undefined;
      },
      // Free turns of accounts without a purchase, per network and day (src/server/network-limits.ts).
      freeTurns: (network) => createNetworkLimits(rateLimiter())(network, "directorFree"),
      log: (m) => console.warn(m),
    });
    return { budget, service };
  })().catch((e) => {
    wired = undefined; // the next request tries again
    throw e;
  });
  return wired;
}
