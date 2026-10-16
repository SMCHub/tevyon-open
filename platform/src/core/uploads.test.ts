import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkUpload, MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, sniffImage, sniffVideo, videoSeconds, videoSize } from "./uploads";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

describe("upload check", () => {
  it("recognises PNG, JPEG and WebP by their first bytes", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
  });

  it("refuses anything else, whatever the browser claims", () => {
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(sniffImage(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull(); // PDF
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });

  it("caps uploads at 10 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("video upload check", () => {
  const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, "testing/fixtures/video", name)));
  /** An ISO-BMFF box: 32-bit size, four-letter type, payload. */
  const box = (type: string, ...payload: Uint8Array[]) => {
    const body = Buffer.concat(payload);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, "latin1");
    return new Uint8Array(Buffer.concat([head, body]));
  };
  const ftyp = (brand: string) => box("ftyp", Buffer.from(brand + "\0\0\0\0" + brand, "latin1"));
  /** mvhd version 1: 64-bit times, then timescale and a 64-bit duration. */
  const mvhdV1 = (timescale: number, duration: bigint) => {
    const b = Buffer.alloc(4 + 8 + 8 + 4 + 8);
    b.writeUInt8(1, 0);
    b.writeUInt32BE(timescale, 20);
    b.writeBigUInt64BE(duration, 24);
    return box("mvhd", b);
  };

  it("recognises MP4 and QuickTime by their ftyp box, never HEIC or AVIF images", () => {
    expect(sniffVideo(fixture("sample-6.5s.mp4"))).toBe("video/mp4");
    expect(sniffVideo(fixture("sample-5s.mov"))).toBe("video/mp4");
    expect(sniffVideo(ftyp("heic"))).toBeNull();
    expect(sniffVideo(ftyp("avif"))).toBeNull();
    expect(sniffVideo(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffVideo(new Uint8Array(0))).toBeNull();
  });

  it("reads the picture size from the video track header and skips the audio track (0×0)", () => {
    expect(videoSize(fixture("sample-320x180-2s-audio.mp4"))).toEqual({ width: 320, height: 180 });
    expect(videoSize(fixture("sample-6.5s.mp4"))).toEqual({ width: 64, height: 64 });
    expect(videoSize(fixture("sample-4s-moov-at-end.mp4"))).toEqual({ width: 64, height: 64 });
    expect(videoSize(ftyp("isom"))).toBeNull();
  });

  it("names a video with its size and length, so the price can read both (upscale bills megapixel seconds)", () => {
    const res = checkUpload(fixture("sample-320x180-2s-audio.mp4"));
    expect(res).toMatchObject({ ok: true, contentType: "video/mp4", suffix: "-320x180_2s" });
  });

  it("reads the duration from the movie header, wherever the moov box sits", () => {
    expect(videoSeconds(fixture("sample-6.5s.mp4"))).toBeCloseTo(6.5, 2);
    expect(videoSeconds(fixture("sample-4s-moov-at-end.mp4"))).toBeCloseTo(4, 2);
    expect(videoSeconds(fixture("sample-5s.mov"))).toBeCloseTo(5, 2);
    expect(videoSeconds(new Uint8Array([...ftyp("isom"), ...box("moov", mvhdV1(600, 7200n))]))).toBeCloseTo(12, 9);
  });

  it("has no duration for a file without a readable movie header", () => {
    expect(videoSeconds(ftyp("isom"))).toBeNull();
    expect(videoSeconds(new Uint8Array([...ftyp("isom"), ...box("moov", mvhdV1(0, 7200n))]))).toBeNull();
    // A box claiming more bytes than the file holds.
    const broken = ftyp("isom");
    new DataView(broken.buffer).setUint32(0, 9999);
    expect(videoSeconds(broken)).toBeNull();
  });

  it("caps video uploads at 50 MB", () => {
    expect(MAX_VIDEO_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("checkUpload", () => {
  const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, "testing/fixtures/video", name)));

  it("accepts an image as it is and names a video by its size and rounded length in seconds", () => {
    expect(checkUpload(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ ok: true, contentType: "image/png", suffix: "" });
    expect(checkUpload(fixture("sample-6.5s.mp4"))).toEqual({ ok: true, contentType: "video/mp4", suffix: "-64x64_7s" });
    expect(checkUpload(fixture("sample-4s-moov-at-end.mp4"))).toEqual({ ok: true, contentType: "video/mp4", suffix: "-64x64_4s" });
  });

  it("refuses a video without a readable length, a too large file and anything else", () => {
    const head = fixture("sample-6.5s.mp4").slice(0, 40);
    expect(checkUpload(head)).toEqual({ ok: false, status: 415, error: "unreadable_video" });
    expect(checkUpload(new TextEncoder().encode("<svg/>"))).toEqual({ ok: false, status: 415, error: "not_an_image" });
    const bigImage = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    bigImage.set([0xff, 0xd8, 0xff]);
    expect(checkUpload(bigImage)).toEqual({ ok: false, status: 413, error: "too_large" });
  });
});
