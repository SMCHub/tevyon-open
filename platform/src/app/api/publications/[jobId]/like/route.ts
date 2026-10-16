import { currentAccount, unauthorized } from "@/server/account";
import { COMMUNITY_STATUS, UUID, community, storageFailure } from "@/server/community";

const notFound = () => Response.json({ ok: false, error: "not_found" }, { status: 404 });

/** Likes a public creation of someone else (once per account): { ok, liked, likes }. */
export async function PUT(_req: Request, ctx: RouteContext<"/api/publications/[jobId]/like">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { jobId } = await ctx.params;
  if (!UUID.test(jobId)) return notFound();
  try {
    const res = await (await community()).like(account.id, jobId);
    return Response.json(res, { status: res.ok ? 200 : COMMUNITY_STATUS[res.error] ?? 400 });
  } catch (e) {
    return storageFailure(e);
  }
}

/** Takes the like back (idempotent). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/publications/[jobId]/like">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { jobId } = await ctx.params;
  if (!UUID.test(jobId)) return notFound();
  try {
    const res = await (await community()).unlike(account.id, jobId);
    return Response.json(res, { status: res.ok ? 200 : 404 });
  } catch (e) {
    return storageFailure(e);
  }
}
