import { buildAccessOverview, type AccessOverview } from "./access-overview";
import { apiKeys } from "./keys";
import { runtime } from "./runtime";

const DAY_MS = 24 * 3600_000;

/** The console's data for one account: keys and apps with their 24-hour spend, and the agents' latest jobs. */
export async function loadAccessOverview(accountId: string): Promise<AccessOverview> {
  const rt = await runtime();
  const keys = await apiKeys().list(accountId);
  const since = Date.now() - DAY_MS;
  const spent = Object.fromEntries(await Promise.all(keys.map(async (k) => [k.id, await rt.repo.spentByKey(k.id, since)] as const)));
  return buildAccessOverview({ keys, spent, jobs: await rt.repo.list(accountId) });
}
