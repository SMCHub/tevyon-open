import { currentAccount } from "@/server/account";
import { community, feedOptions, handleParam, storageFailure } from "@/server/community";

/**
 * A creator's page: the public profile, how many creations are public, followers and followed accounts (counts only),
 * and those creations (same paging as /api/community). Open to everyone; a signed-in account also learns whether it
 * follows them and what it likes.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/community/[handle]">) {
  const viewer = await currentAccount();
  const { handle } = await ctx.params;
  try {
    const page = await (await community()).creator(handleParam(handle), feedOptions(req), viewer?.id);
    if (!page) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, ...page });
  } catch (e) {
    return storageFailure(e);
  }
}
