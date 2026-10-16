import { currentAccount, unauthorized } from "@/server/account";
import { apiKeys } from "@/server/keys";
import { sameOrigin, sessionOnly } from "../guard";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => Response.json({ ok: false, error: "not_found" }, { status: 404 });

/** Revokes a key or ends an OAuth connection at once: every client using it gets 401 from the next request on. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/keys/[id]">) {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (account.via !== "session") return sessionOnly();
  const { id } = await ctx.params;
  if (!ID.test(id) || !(await apiKeys().revoke(account.id, id))) return notFound();
  return new Response(null, { status: 204 });
}

/** Sets the daily limit of a key or connection: { dailyLimit: credits per 24 hours, or null for no limit }. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/keys/[id]">) {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (account.via !== "session") return sessionOnly();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { dailyLimit?: unknown };
  const limit = body.dailyLimit === null ? null : typeof body.dailyLimit === "number" ? body.dailyLimit : undefined;
  if (limit === undefined) return Response.json({ ok: false, error: "invalid_limit" }, { status: 400 });
  if (!ID.test(id)) return notFound();
  if (!(await apiKeys().setDailyLimit(account.id, id, limit))) {
    return Response.json({ ok: false, error: "invalid_limit_or_not_found" }, { status: 400 });
  }
  return Response.json({ ok: true, dailyLimit: limit });
}
