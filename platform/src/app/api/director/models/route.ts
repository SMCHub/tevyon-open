import { comfyKey } from "@/server/comfy";
import { currentAccount, unauthorized } from "@/server/account";
import { director } from "@/server/director-deps";

/**
 * GET /api/director/models → the Director's language models for the picker: name, maker, tier, cost class 1–4, and
 * what each costs this account today: free turns left from the daily budget, or credits per message (typical and at
 * most) for the strongest models, locked until the first purchase. No vendor ids, no USD.
 */
export async function GET() {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { service } = await director();
  const key = account.keyId ? { id: account.keyId, dailyLimit: account.dailyLimit ?? null } : undefined;
  return Response.json({ ok: true, live: Boolean(comfyKey()), ...(await service.overview(account.id, key)) });
}
