import { currentAccount, unauthorized } from "@/server/account";
import { director } from "@/server/director-deps";
import { countedNetwork } from "@/server/network-limits";

/**
 * POST /api/marketing/agent { history, model?, photo?, hasAvatar?, product?: { name?, description? } } → the Marketing
 * Agent's campaign plan as server-sent events, like POST /api/director: text pieces, then up to four priced creatives
 * (`type: "marketing"`), done and what is left of today's budget. `photo` is the product photo (an own upload). The
 * agent shares the Director's daily budget and models. Never starts a job: each creative starts with the user's click.
 */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const body = await req.json().catch(() => null);
  const key = account.keyId ? { id: account.keyId, dailyLimit: account.dailyLimit ?? null } : undefined;
  const brief = body && typeof body === "object" ? { ...(body as Record<string, unknown>), agent: "marketing" } : body;
  return (await director()).service.respond(account.id, brief, req.signal, key, countedNetwork(account.via, req.headers));
}
