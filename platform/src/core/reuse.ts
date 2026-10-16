import type { JobView } from "./jobs";
import type { MediaStore } from "./media";
import { createHash } from "node:crypto";
import { sniffImage, sniffVideo, videoSeconds, videoSize } from "./uploads";

export type ReuseResult = { ok: true; url: string } | { ok: false; error: "not_found" | "not_an_image" };

/**
 * Turns one of the account's own finished images or videos into an upload, so it can serve as a reference (or a recast
 * clip). Inputs must be uploads of the caller (jobs.ts checks every file parameter); a copy keeps that one rule instead
 * of a second one for results. Only raster images and readable videos pass, checked by their bytes like any upload. No
 * scan: results come from our own moderated models. The name is the content hash, so taking a result twice adds nothing.
 */
export async function reuseOutput(
  deps: {
    getJob: (accountId: string, jobId: string) => Promise<JobView | undefined>;
    read: (url: string) => Promise<Uint8Array | undefined> | Uint8Array | undefined;
    media: MediaStore;
  },
  accountId: string,
  jobId: string,
  index: number,
): Promise<ReuseResult> {
  const job = await deps.getJob(accountId, jobId);
  const out = job?.status === "succeeded" ? job.outputs[index] : undefined;
  if (!out) return { ok: false, error: "not_found" };
  const data = await deps.read(out.url);
  if (!data) return { ok: false, error: "not_found" };
  // No upload size limit here: a 4K result of our own may be larger than what users may upload.
  const name = createHash("sha256").update(data).digest("hex");
  const image = sniffImage(data);
  if (image) return { ok: true, url: await deps.media.put(`uploads/${accountId}/${name}`, data, image) };
  const seconds = sniffVideo(data) ? videoSeconds(data) : null;
  if (!seconds || seconds <= 0) return { ok: false, error: "not_an_image" };
  const size = videoSize(data);
  return { ok: true, url: await deps.media.put(`uploads/${accountId}/${name}${size ? `-${size.width}x${size.height}` : ""}_${Math.round(seconds)}s`, data, "video/mp4") };
}
