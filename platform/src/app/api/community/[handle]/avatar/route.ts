import { community, handleParam } from "@/server/community";
import { runtime } from "@/server/runtime";

/**
 * A profile's picture, open to everyone while the profile is visible. The address carries the profile's version
 * (?v=…), so the file may be cached for good; the upload path behind it never leaves the server.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/community/[handle]/avatar">) {
  const { handle } = await ctx.params;
  try {
    const key = await (await community()).avatarFile(handleParam(handle));
    const file = key ? await (await runtime()).media.open(key) : null;
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(file.stream(), {
      headers: { "content-type": file.contentType, "content-length": String(file.size), "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
