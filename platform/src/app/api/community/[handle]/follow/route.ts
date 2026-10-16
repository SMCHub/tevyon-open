import { currentAccount, unauthorized } from "@/server/account";
import { COMMUNITY_STATUS, community, handleParam, storageFailure } from "@/server/community";

/** Follows the creator: { ok, following, followers }. Not yourself. */
export async function PUT(_req: Request, ctx: RouteContext<"/api/community/[handle]/follow">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { handle } = await ctx.params;
  try {
    const res = await (await community()).follow(account.id, handleParam(handle));
    return Response.json(res, { status: res.ok ? 200 : COMMUNITY_STATUS[res.error] ?? 400 });
  } catch (e) {
    return storageFailure(e);
  }
}

/** Stops following (idempotent). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/community/[handle]/follow">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { handle } = await ctx.params;
  try {
    const res = await (await community()).unfollow(account.id, handleParam(handle));
    return Response.json(res, { status: res.ok ? 200 : 404 });
  } catch (e) {
    return storageFailure(e);
  }
}
