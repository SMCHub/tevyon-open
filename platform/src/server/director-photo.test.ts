import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { visionDataUrl } from "./director-photo";

describe("photo for a vision model", () => {
  it("is a JPEG of at most 1568 px on the longer edge, without location or camera data", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#4a6" } })
      .jpeg()
      .withExif({ IFD0: { Make: "PhoneCo", Model: "X1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "47/1 22/1 0/1" } })
      .toBuffer();
    expect((await sharp(big).metadata()).exif).toBeDefined();

    const url = await visionDataUrl(big);

    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    const out = await sharp(Buffer.from(url.split(",")[1]!, "base64")).metadata();
    expect([out.format, out.width, out.height]).toEqual(["jpeg", 1568, 1176]);
    expect(out.exif).toBeUndefined();
  });

  it("leaves small photos at their size", async () => {
    const small = await sharp({ create: { width: 640, height: 800, channels: 3, background: "#222" } }).png().toBuffer();
    const out = await sharp(Buffer.from((await visionDataUrl(small)).split(",")[1]!, "base64")).metadata();
    expect([out.format, out.width, out.height]).toEqual(["jpeg", 640, 800]);
  });
});
