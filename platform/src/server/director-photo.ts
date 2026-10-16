/** Longest edge the vision models get: they scale larger photos down to about this anyway, the extra bytes only cost time. */
const EDGE = 1_568;

/**
 * An uploaded photo as a JPEG data URL for a vision model: upright (EXIF orientation applied), at most 1568 px on the
 * longer edge, and without metadata, so no location or camera data leaves our server.
 * sharp comes with Next.js (image optimisation) and is loaded only when a photo is sent.
 */
export async function visionDataUrl(data: Uint8Array): Promise<string> {
  const { default: sharp } = await import("sharp");
  const jpeg = await sharp(data)
    .rotate()
    .resize({ width: EDGE, height: EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}
