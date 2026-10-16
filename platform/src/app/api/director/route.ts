import { currentAccount, unauthorized } from "@/server/account";
import { director } from "@/server/director-deps";
import { countedNetwork } from "@/server/network-limits";

/**
 * POST /api/director { history: [{ role, content }], model?, photo?, hasPhoto? } → server-sent events, one JSON
 * object per `data:` line: text pieces, then proposals, done and what is left of today's budget (src/server/director.ts).
 * Refusals come as JSON with an error code and a reply to show. Never starts a job.
 */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const body = await req.json().catch(() => null);
  const key = account.keyId ? { id: account.keyId, dailyLimit: account.dailyLimit ?? null } : undefined;
  return (await director()).service.respond(account.id, body, req.signal, key, countedNetwork(account.via, req.headers));
}
