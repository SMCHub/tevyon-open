import { currentAccount, unauthorized } from "@/server/account";
import { loadAccessOverview } from "@/server/access-overview-load";
import { apiKeys } from "@/server/keys";
import { sameOrigin, sessionOnly } from "./guard";

/**
 * The account's keys and apps (name, prefix, last use, limit, spend in the last 24 h) and the latest jobs agents
 * started. Never a key itself. The «API & MCP» console polls this.
 */
export async function GET() {
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (account.via !== "session") return sessionOnly();
  return Response.json(await loadAccessOverview(account.id), { headers: { "cache-control": "no-store" } });
}

/** Issues a key. The response is the only time the key is shown. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (account.via !== "session") return sessionOnly();
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; dailyLimit?: unknown };
  const res = await apiKeys().issue(account.id, {
    name: typeof body.name === "string" ? body.name : "",
    ...(account.email ? { email: account.email } : {}),
    ...(body.dailyLimit === null || typeof body.dailyLimit === "number" ? { dailyLimit: body.dailyLimit } : {}),
  });
  if (!res.ok) return Response.json(res, { status: res.error === "too_many_keys" ? 409 : 400 });
  return Response.json(res, { status: 201, headers: { "cache-control": "no-store" } });
}
