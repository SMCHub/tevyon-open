import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { labelAiOutput } from "./ai-label";

const VIDEO = path.join(import.meta.dirname, "testing/fixtures/video/sample-6.5s.mp4");
const latin = (b: Uint8Array) => Buffer.from(b).toString("latin1");

/** A tiny picture: three by two pixels, half transparent where the format can say so. */
const pixels = (alpha: boolean) =>
  sharp({ create: { width: 3, height: 2, channels: alpha ? 4 : 3, background: { r: 200, g: 40, b: 90, alpha: alpha ? 0.5 : 1 } } });

const IMAGES: [string, string, () => Promise<Buffer>][] = [
  ["PNG", "image/png", () => pixels(false).png().toBuffer()],
  ["PNG with alpha", "image/png", () => pixels(true).png().toBuffer()],
  ["JPEG", "image/jpeg", () => pixels(false).jpeg().toBuffer()],
  ["WebP (lossy, simple)", "image/webp", () => pixels(false).webp().toBuffer()],
  ["WebP (lossless with alpha)", "image/webp", () => pixels(true).webp({ lossless: true }).toBuffer()],
];

describe("machine-readable AI label (AI Act Art. 50)", () => {
  it.each(IMAGES)("marks a %s as AI-made without touching a pixel", async (_name, type, make) => {
    const original = new Uint8Array(await make());
    const labelled = labelAiOutput(original, type);
    expect(labelled).not.toEqual(original);

    // Still the same picture for any decoder, now with the IPTC source type in its XMP.
    const meta = await sharp(labelled).metadata();
    expect([meta.width, meta.height]).toEqual([3, 2]);
    expect(Buffer.from(meta.xmp ?? []).toString()).toContain("http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia");
    expect(await sharp(labelled).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer());

    // Tevyon as the tool, nothing about the model or where it came from; a second pass changes nothing.
    expect(latin(labelled)).toContain("<xmp:CreatorTool>Tevyon</xmp:CreatorTool>");
    expect(labelAiOutput(labelled, type)).toEqual(labelled);
  });

  it("appends the label to a video and keeps every byte before it", () => {
    const original = new Uint8Array(readFileSync(VIDEO));
    const labelled = labelAiOutput(original, "video/mp4");
    expect(labelled.length).toBeGreaterThan(original.length);
    expect(labelled.subarray(0, original.length)).toEqual(original);
    // A top-level uuid box with the XMP UUID (be7acfcb-97a9-42e8-9c71-999491e3afac) and the packet.
    const tail = labelled.subarray(original.length);
    expect(new DataView(tail.buffer, tail.byteOffset).getUint32(0)).toBe(tail.length);
    expect(latin(tail.subarray(4, 8))).toBe("uuid");
    expect(Buffer.from(tail.subarray(8, 24)).toString("hex")).toBe("be7acfcb97a942e89c71999491e3afac");
    expect(latin(tail)).toContain("trainedAlgorithmicMedia");
    expect(labelAiOutput(labelled, "video/mp4")).toEqual(labelled);
  });

  it("never touches a file that carries a C2PA manifest: any change would break its signature", async () => {
    const png = new Uint8Array(await pixels(false).png().toBuffer());
    // A caBX chunk (C2PA in PNG) right after IHDR, as the vendors write it.
    const body = new TextEncoder().encode("\u0000\u0000\u0000 jumb\u0000\u0000\u0000\u0018jumdc2pa");
    const chunk = new Uint8Array(12 + body.length);
    new DataView(chunk.buffer).setUint32(0, body.length);
    chunk.set(new TextEncoder().encode("caBX"), 4);
    chunk.set(body, 8);
    const signed = new Uint8Array([...png.subarray(0, 33), ...chunk, ...png.subarray(33)]);
    expect(labelAiOutput(signed, "image/png")).toBe(signed);
  });

  it("leaves data alone it cannot read safely", () => {
    for (const [data, type] of [
      [new Uint8Array([137, 80, 78, 71]), "image/png"],
      [new Uint8Array([0xff, 0xd8]), "image/jpeg"],
      [new Uint8Array(new TextEncoder().encode("RIFF\u0004\u0000\u0000\u0000WEBP")), "image/webp"],
      [new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101]), "video/mp4"],
      // ftyp, then an mdat “to the end of the file” (size 0): an appended box would end up inside the video data.
      [new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 109, 100, 97, 116, 1, 2, 3]), "video/mp4"],
      [new Uint8Array([1, 2, 3]), "image/gif"],
    ] as const) {
      expect(labelAiOutput(data, type), type).toBe(data);
    }
  });
});
