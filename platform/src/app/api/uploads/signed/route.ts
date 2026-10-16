import { MAX_VIDEO_BYTES } from "@/core/uploads";
import { uploadLinks } from "@/server/upload-links";
import { acceptAccountUpload, refusal } from "@/server/uploads";

/**
 * PUT /api/uploads/signed?acc=…&id=…&exp=…&sig=… with the raw image or reference video as body: the upload address that the MCP tool
 * create_upload hands to an agent. The signature names account and file; no login, no API key needed for 15 minutes.
 */
export async function PUT(req: Request) {
  const link = uploadLinks().verify(new URL(req.url).searchParams);
  if (!link) return Response.json({ ok: false, error: "invalid_or_expired_link" }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_VIDEO_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  const data = new Uint8Array(await req.arrayBuffer());
  // Named after its content like every upload: the link may be used again within its time, but never puts other bytes
  // under an address handed out before (a consent is bound to that address). The answer carries the url.
  const res = await acceptAccountUpload(link.accountId, data);
  if (!res.ok) return refusal(res);
  return Response.json({ ok: true, url: res.url }, { status: 201 });
}

export const POST = PUT;

/** The upload scan takes seconds (up to a minute for a video): more than the platform's default request time. */
export const maxDuration = 90;
