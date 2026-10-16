/** Uploads are only accepted as real raster images, checked by their first bytes (SVG can carry script). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Reference videos (MP4 or QuickTime) may be larger than images; the vendor takes about this much. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** ISO-BMFF brands of real videos. HEIC and AVIF use the same container but are images. */
const VIDEO_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "qt  ", "M4V ", "M4VP", "dash", "mmp4", "MSNV", "3gp4", "3gp5", "3g2a"]);

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

/** MP4 and QuickTime by their ftyp box. Both are stored and served as video/mp4 (the vendor and browsers read either). */
export function sniffVideo(b: Uint8Array): "video/mp4" | null {
  if (b.length < 12 || fourcc(b, 4) !== "ftyp") return null;
  return VIDEO_BRANDS.has(fourcc(b, 8)) ? "video/mp4" : null;
}

/** The boxes inside [start, end): type and payload range. Stops at the first box that does not fit. */
function* boxes(b: Uint8Array, start: number, end: number): Generator<{ type: string; from: number; to: number }> {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type: fourcc(b, at + 4), from: at + header, to: at + size };
    at += size;
  }
}

/** Duration in seconds from the movie header (moov/mvhd), or null if the file has none we can read. */
export function videoSeconds(b: Uint8Array): number | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (const moov of boxes(b, 0, b.length)) {
    if (moov.type !== "moov") continue;
    for (const mvhd of boxes(b, moov.from, moov.to)) {
      if (mvhd.type !== "mvhd") continue;
      const v1 = b[mvhd.from] === 1;
      const need = v1 ? 32 : 20;
      if (mvhd.to - mvhd.from < need) return null;
      const timescale = view.getUint32(mvhd.from + (v1 ? 20 : 12));
      const duration = v1 ? Number(view.getBigUint64(mvhd.from + 24)) : view.getUint32(mvhd.from + 16);
      return timescale > 0 ? duration / timescale : null;
    }
  }
  return null;
}

/**
 * Picture size of the first video track (moov/trak/tkhd: width and height are its last 8 bytes, 16.16 fixed point).
 * Audio tracks carry 0×0 and are skipped. Null when the file has none we can read. A rotation matrix is ignored:
 * the megapixels the price needs are the same either way.
 */
export function videoSize(b: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (const moov of boxes(b, 0, b.length)) {
    if (moov.type !== "moov") continue;
    for (const trak of boxes(b, moov.from, moov.to)) {
      if (trak.type !== "trak") continue;
      for (const tkhd of boxes(b, trak.from, trak.to)) {
        if (tkhd.type !== "tkhd" || tkhd.to - tkhd.from < 84) continue;
        const width = view.getUint32(tkhd.to - 8) >>> 16;
        const height = view.getUint32(tkhd.to - 4) >>> 16;
        if (width > 0 && height > 0) return { width, height };
      }
    }
  }
  return null;
}

export type UploadCheck =
  | { ok: true; contentType: ImageType | "video/mp4"; suffix: string }
  | { ok: false; status: 413 | 415; error: "too_large" | "unreadable_video" | "not_an_image" };

/**
 * One check for every upload route. Images stay as they are. A video gets its size and its length, rounded to whole
 * seconds, in the file name ("-1280x720_12s"): only the server names files, so a job can read what it bills (length,
 * megapixels) from its own upload URL.
 */
export function checkUpload(data: Uint8Array): UploadCheck {
  const image = sniffImage(data);
  if (image) return data.byteLength > MAX_UPLOAD_BYTES ? { ok: false, status: 413, error: "too_large" } : { ok: true, contentType: image, suffix: "" };
  // Neither image nor video: the code clients already know from the image-only days.
  if (!sniffVideo(data)) return { ok: false, status: 415, error: "not_an_image" };
  if (data.byteLength > MAX_VIDEO_BYTES) return { ok: false, status: 413, error: "too_large" };
  const seconds = videoSeconds(data);
  if (seconds === null || seconds <= 0) return { ok: false, status: 415, error: "unreadable_video" };
  // Size before length ("-1280x720_12s"): the length stays the last part, where every reader of it looks.
  const size = videoSize(data);
  return { ok: true, contentType: "video/mp4", suffix: `${size ? `-${size.width}x${size.height}` : ""}_${Math.round(seconds)}s` };
}
