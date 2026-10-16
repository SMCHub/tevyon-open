import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileMediaStore } from "./file-media";
import { byteRange } from "./http-range";

const SIZE = 8_429_693; // the Veo clip of 13.10.2026

describe("byte ranges (video playback and seeking)", () => {
  it("serves the requested slice", () => {
    expect(byteRange("bytes=0-1023", SIZE)).toEqual({ start: 0, end: 1023 });
    expect(byteRange("bytes=0-1", SIZE)).toEqual({ start: 0, end: 1 }); // Safari's first probe
  });

  it("serves from an offset to the end, and the last n bytes", () => {
    expect(byteRange("bytes=1000-", SIZE)).toEqual({ start: 1000, end: SIZE - 1 });
    expect(byteRange("bytes=-500", SIZE)).toEqual({ start: SIZE - 500, end: SIZE - 1 });
  });

  it("cuts an end beyond the file to the file", () => {
    expect(byteRange("bytes=8429000-9999999", SIZE)).toEqual({ start: 8429000, end: SIZE - 1 });
  });

  it("says when a range starts behind the file", () => {
    expect(byteRange(`bytes=${SIZE}-`, SIZE)).toBe("unsatisfiable");
  });

  it("serves the whole file without a usable range", () => {
    expect(byteRange(null, SIZE)).toBeUndefined();
    expect(byteRange("items=0-5", SIZE)).toBeUndefined();
    expect(byteRange("bytes=5-1", SIZE)).toBeUndefined();
    expect(byteRange("bytes=0-1,5-9", SIZE)).toBeUndefined(); // several ranges: the whole file is a valid answer
  });
});

describe("file media store", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function storeWithClip() {
    root = await mkdtemp(path.join(tmpdir(), "tachyon-media-"));
    const media = createFileMediaStore(root);
    const data = new Uint8Array(4096).map((_, i) => i % 251);
    const url = await media.put("job-1/0", data, "video/mp4");
    return { media, data, key: url.replace(/^\/api\/media\//, "") };
  }

  async function bytes(stream: ReadableStream<Uint8Array>) {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  it("lists the files under a folder, newest first, and nothing for a folder that is missing or outside", async () => {
    root = await mkdtemp(path.join(tmpdir(), "tachyon-media-"));
    const media = createFileMediaStore(root);
    await media.put("uploads/acc/a", new Uint8Array([1]), "image/png");
    await new Promise((r) => setTimeout(r, 15));
    await media.put("uploads/acc/b_6s", new Uint8Array([2]), "video/mp4");
    await media.put("uploads/other/c", new Uint8Array([3]), "image/png");
    const listed = await media.list("uploads/acc", 10);
    expect(listed.map((f) => [f.url, f.kind])).toEqual([["/api/media/uploads/acc/b_6s.mp4", "video"], ["/api/media/uploads/acc/a.png", "image"]]);
    expect(await media.list("uploads/nobody", 10)).toEqual([]);
    expect(await media.list("../..", 10)).toEqual([]);
  });

  it("opens a file with its size and type, and streams it in full or in part", async () => {
    const { media, data, key } = await storeWithClip();
    const file = await media.open(key);

    expect(file).toMatchObject({ size: 4096, contentType: "video/mp4" });
    expect(await bytes(file!.stream())).toEqual(data);
    expect(await bytes(file!.stream({ start: 100, end: 199 }))).toEqual(data.slice(100, 200));
  });

  it("opens nothing outside its folder and nothing that is missing", async () => {
    const { media } = await storeWithClip();
    expect(await media.open("../../etc/passwd")).toBeUndefined();
    expect(await media.open("job-1/missing.mp4")).toBeUndefined();
    expect(await media.open("job-1")).toBeUndefined(); // a folder is no file
  });
});
