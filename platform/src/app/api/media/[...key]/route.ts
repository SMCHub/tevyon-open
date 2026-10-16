import { currentAccount, unauthorized } from "@/server/account";
import { community } from "@/server/community";
import { byteRange } from "@/server/http-range";
import { isSignedMediaRequest } from "@/server/media-links";
import { runtime } from "@/server/runtime";

/**
 * Serves job outputs ({jobId}/{index}.{ext}) and uploads (uploads/{accountId}/{id}.{ext}), only to their owner. A result
 * its owner published in the community opens for
 * everyone, signed in or not (the community is public), but only the one file the community shows, and only while it
 * is public (core/community.ts). A signed link (?exp=…&sig=…, issued to agents over MCP) opens the file without a login
 * until it expires.
 */
/** Whether others may open this result file; a community store that fails (or is not migrated yet) opens nothing. */
async function publicMedia(path: string): Promise<boolean> {
  try {
    return await (await community()).isPublicMedia(path);
  } catch {
    return false;
  }
}

export async function GET(req: Request, ctx: RouteContext<"/api/media/[...key]">) {
  const { key } = await ctx.params;
  const rt = await runtime();
  if (!isSignedMediaRequest(key.join("/"), new URL(req.url))) {
    const account = await currentAccount();
    // Without a login only a published result opens (never uploads).
    if (!account) {
      if (key[0] === "uploads" || !(await publicMedia(key.join("/")))) return unauthorized();
    } else if (key[0] === "uploads") {
      // Uploads live under uploads/{accountId}/…: only the uploader may read them.
      if (key[1] !== account.id || key.length !== 3) return new Response("Not found", { status: 404 });
    } else {
      const job = await rt.repo.get(key[0] ?? "");
      if (!job || (job.accountId !== account.id && !(await publicMedia(key.join("/"))))) return new Response("Not found", { status: 404 });
    }
  }
  const file = await rt.media.open(key.join("/"));
  if (!file) return new Response("Not found", { status: 404 });
  // Streamed, never read into memory whole; video is served in byte ranges (Safari plays nothing without them).
  const headers = { "content-type": file.contentType, "cache-control": "private, max-age=31536000, immutable", "accept-ranges": "bytes" };
  const range = byteRange(req.headers.get("range"), file.size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${file.size}` } });
  if (range) {
    return new Response(file.stream(range), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${file.size}`, "content-length": String(range.end - range.start + 1) },
    });
  }
  return new Response(file.stream(), { headers: { ...headers, "content-length": String(file.size) } });
}
