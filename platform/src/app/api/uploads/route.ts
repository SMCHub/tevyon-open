import { MAX_VIDEO_BYTES } from "@/core/uploads";
import { currentAccount, unauthorized } from "@/server/account";
import { mediaStore, runtime } from "@/server/runtime";
import { acceptAccountUpload, refusal } from "@/server/uploads";

/**
 * POST /api/uploads with the raw file as body: an image (start frame, reference) or an MP4/MOV reference video.
 * Returns the file's own media URL; a video's URL carries its length in seconds ("…_12s.mp4"). Every file is scanned
 * first (core/upload-scan.ts): a blocked one is never stored (422 upload_blocked), no scan means no upload (503).
 */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (Number(req.headers.get("content-length") ?? 0) > MAX_VIDEO_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  const data = new Uint8Array(await req.arrayBuffer());
  const res = await acceptAccountUpload(account.id, data);
  if (!res.ok) return refusal(res);
  return Response.json({ ok: true, url: res.url }, { status: 201 });
}

/** How many earlier uploads the picker shows (newest first). */
const LIST_LIMIT = 80;

/** GET /api/uploads: the account's own earlier uploads, newest first, to pick again instead of uploading the same file anew. */
export async function GET() {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const rt = await runtime();
  // A runtime built before list() existed (dev server not restarted yet) gets a fresh store with the same files.
  const media = "list" in rt.media && typeof rt.media.list === "function" ? rt.media : mediaStore();
  const uploads = await media.list(`uploads/${account.id}`, LIST_LIMIT).catch(() => []);
  return Response.json({ ok: true, uploads });
}

/** The upload scan takes seconds (up to a minute for a video): more than the platform's default request time. */
export const maxDuration = 90;
