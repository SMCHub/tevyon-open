import { currentAccount, unauthorized } from "@/server/account";
import { sameOrigin } from "@/server/consent";
import { runtime } from "@/server/runtime";

/** GET /api/consent/{id}: the state of a consent request of this account (pending, confirmed, declined, used, expired). */
export async function GET(_req: Request, ctx: RouteContext<"/api/consent/[id]">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { id } = await ctx.params;
  const view = await (await runtime()).consent.view(account.id, id);
  if (!view) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, ...view, expiresAt: new Date(view.expiresAt).toISOString() });
}

/**
 * POST /api/consent/{id} { action: "confirm" | "decline" }: the person's decision. Only from a Studio session on our
 * own page, never with an API key or app token: an agent must not confirm its own request.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/consent/[id]">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (account.via !== "session" || !sameOrigin(req)) return Response.json({ ok: false, error: "confirm_in_studio" }, { status: 403 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const consent = (await runtime()).consent;
  const res = body.action === "confirm" ? await consent.confirm(account.id, id) : body.action === "decline" ? await consent.decline(account.id, id) : null;
  if (!res) return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  return Response.json(res, { status: res.ok ? 200 : res.error === "not_found" ? 404 : 409 });
}
