import { currentAccount, unauthorized } from "@/server/account";
import { COMMUNITY_STATUS, UUID, community, storageFailure } from "@/server/community";

const notFound = () => Response.json({ ok: false, error: "not_found" }, { status: 404 });

/**
 * Publishes one of the account's finished creations to the community, or changes what a public one shows:
 * { showPrompt?: boolean, consent?: boolean } (consent: needed once for a creation made from the account's uploads).
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/publications/[jobId]">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { jobId } = await ctx.params;
  if (!UUID.test(jobId)) return notFound();
  const body = ((await req.json().catch(() => null)) ?? {}) as { showPrompt?: unknown; consent?: unknown };
  try {
    const res = await (await community()).publish(account.id, jobId, {
      ...(typeof body.showPrompt === "boolean" ? { showPrompt: body.showPrompt } : {}),
      consent: body.consent === true,
    });
    return Response.json(res, { status: res.ok ? 200 : COMMUNITY_STATUS[res.error] ?? 400 });
  } catch (e) {
    return storageFailure(e);
  }
}

/** Makes the creation private again (idempotent). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/publications/[jobId]">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { jobId } = await ctx.params;
  if (!UUID.test(jobId)) return notFound();
  try {
    const res = await (await community()).unpublish(account.id, jobId);
    return Response.json(res, { status: res.ok ? 200 : 404 });
  } catch (e) {
    return storageFailure(e);
  }
}
