/**
 * Motion library: ready-made recast templates (a driving video plus its mode and prompt). The user brings only the
 * reference images. The only IO is the copy behind "Recreate", through the ports it is given.
 */

import type { MediaStore } from "./media";
import { checkUpload } from "./uploads";

export type LibraryCategory = "curated" | "trending" | "new";

export type LibraryPreset = {
  id: string;
  title: string;
  description: string;
  mode: "motion" | "replace";
  /** Prompt in the vendor's syntax (@Image n, @Video 1). Empty when the template needs none. */
  prompt: string;
  /** Reference images the template is made for: the prompt may name up to this many. */
  images: number;
  resolution: "480p" | "720p";
  /** Driving video length in whole seconds (4–30), the billed length. */
  seconds: number;
  width: number;
  height: number;
  /** Rank per tab, 0 = first. */
  categories: Partial<Record<LibraryCategory, number>>;
  /** Our own media: driving video, result preview, poster. */
  media: { video: string; preview: string; poster: string };
};

export type RecreateResult =
  | { ok: true; video: string; mode: LibraryPreset["mode"]; prompt: string; resolution: LibraryPreset["resolution"]; images: number }
  | { ok: false; error: "not_found" };

/**
 * "Recreate": the template's driving video becomes an upload of the caller, so the recast job takes it like any own
 * video (one ownership rule, jobs.ts). Its name carries the length read from the file itself, as for every upload.
 */
export async function recreateFromLibrary(
  deps: { presets: LibraryPreset[]; read: (url: string) => Promise<Uint8Array | undefined>; media: MediaStore },
  accountId: string,
  id: string,
): Promise<RecreateResult> {
  const preset = deps.presets.find((p) => p.id === id);
  const data = preset ? await deps.read(preset.media.video) : undefined;
  const check = data ? checkUpload(data) : undefined;
  if (!preset || !data || !check?.ok || check.contentType !== "video/mp4") return { ok: false, error: "not_found" };
  const video = await deps.media.put(`uploads/${accountId}/${crypto.randomUUID()}${check.suffix}`, data, check.contentType);
  return { ok: true, video, mode: preset.mode, prompt: preset.prompt, resolution: preset.resolution, images: preset.images };
}
