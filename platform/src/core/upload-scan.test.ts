import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryMediaStore } from "./media";
import { acceptUpload, type ScanVerdict, type UploadScanner } from "./upload-scan";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(32).fill(7)]);
const video = new Uint8Array(readFileSync(path.join(import.meta.dirname, "testing/fixtures/video", "sample-5s.mov")));

function scanner(verdict: ScanVerdict | Error) {
  const seen: { contentType: string; bytes: number }[] = [];
  const s: UploadScanner = {
    async scan(file) {
      seen.push({ contentType: file.contentType, bytes: file.data.byteLength });
      if (verdict instanceof Error) throw verdict;
      return verdict;
    },
  };
  return { s, seen };
}

describe("accepting an upload", () => {
  it("scans the file and stores it only when the scan allows it", async () => {
    const media = createMemoryMediaStore("/api/media");
    const { s, seen } = scanner({ allowed: true });
    const res = await acceptUpload({ scanner: s, media }, "acc-1", png);
    expect(res.ok).toBe(true);
    expect(seen).toEqual([{ contentType: "image/png", bytes: png.byteLength }]);
    if (res.ok) expect(media.read(res.url)).toEqual(png);
  });

  it("never stores a blocked file and names the category", async () => {
    const media = createMemoryMediaStore("/api/media");
    const logged: string[] = [];
    const { s } = scanner({ allowed: false, category: "nudity" });
    const res = await acceptUpload({ scanner: s, media, log: (m) => logged.push(m) }, "acc-1", png);
    expect(res).toEqual({ ok: false, status: 422, error: "upload_blocked", category: "nudity" });
    expect(media.read("/api/media/uploads/acc-1/x")).toBeUndefined();
    // The log names account, kind and category, never the bytes.
    expect(logged.join()).toContain("acc-1");
    expect(logged.join()).toContain("nudity");
  });

  it("refuses the upload when the scan cannot run (every upload must be checked)", async () => {
    const media = createMemoryMediaStore("/api/media");
    const { s } = scanner(new Error("network down"));
    const res = await acceptUpload({ scanner: s, media }, "acc-1", png);
    expect(res).toEqual({ ok: false, status: 503, error: "scan_unavailable" });
  });

  it("gives up after its time limit instead of holding the upload open", async () => {
    const media = createMemoryMediaStore("/api/media");
    const hanging: UploadScanner = {
      scan: (_file, signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const res = await acceptUpload({ scanner: hanging, media, timeoutMs: { image: 20, video: 20 } }, "acc-1", png);
    expect(res).toEqual({ ok: false, status: 503, error: "scan_unavailable" });
  });

  it("checks the bytes before it spends a scan", async () => {
    const media = createMemoryMediaStore("/api/media");
    const { s, seen } = scanner({ allowed: true });
    const res = await acceptUpload({ scanner: s, media }, "acc-1", new TextEncoder().encode("<svg></svg>"));
    expect(res).toEqual({ ok: false, status: 415, error: "not_an_image" });
    expect(seen).toEqual([]);
  });

  it("stores the same file once: the key is its content hash, so a second upload adds nothing new", async () => {
    const media = createMemoryMediaStore("/api/media");
    const { s } = scanner({ allowed: true });
    const a = await acceptUpload({ scanner: s, media }, "acc-1", png);
    const b = await acceptUpload({ scanner: s, media }, "acc-1", png);
    expect(a.ok && b.ok && a.url === b.url).toBe(true);
    if (a.ok) expect(a.url).toMatch(/^\/api\/media\/uploads\/acc-1\/[0-9a-f]{64}$/);
  });

  it("scans a video as a video and keeps its length in the name", async () => {
    const media = createMemoryMediaStore("/api/media");
    const { s, seen } = scanner({ allowed: true });
    const res = await acceptUpload({ scanner: s, media }, "acc-1", video);
    expect(seen[0]?.contentType).toBe("video/mp4");
    if (res.ok) expect(res.url).toMatch(/_5s$/);
  });

  it("refuses an upload over the account's daily share before the paid scan, and stores nothing", async () => {
    const media = createMemoryMediaStore("/api/media");
    const { s, seen } = scanner({ allowed: true });
    const counted: string[] = [];
    const allow = async (accountId: string) => (counted.push(accountId), counted.length <= 1);
    expect((await acceptUpload({ scanner: s, media, allow }, "acc-1", png)).ok).toBe(true);
    expect(await acceptUpload({ scanner: s, media, allow }, "acc-1", new Uint8Array([...png, 1]))).toEqual({ ok: false, status: 429, error: "upload_limit" });
    expect(seen).toHaveLength(1);
    // A file that is no image costs no scan, so it does not count either.
    expect((await acceptUpload({ scanner: s, media, allow }, "acc-1", new Uint8Array([1, 2, 3]))).ok).toBe(false);
    expect(counted).toHaveLength(2);
  });

  it("names every upload after its content, so a confirmed picture can never get other bytes under its address", async () => {
    const media = createMemoryMediaStore("/api/media");
    const { s } = scanner({ allowed: true });
    const other = new Uint8Array([...png, 1]);
    // A signed link may be used several times within its 15 minutes; a name from outside would let the second file
    // replace the first under the URL a consent was confirmed for.
    const first = await acceptUpload({ scanner: s, media }, "acc-1", png);
    const second = await acceptUpload({ scanner: s, media }, "acc-1", other);
    expect(first.ok && second.ok && first.url !== second.url).toBe(true);
    expect(first.ok && first.url).toMatch(/^\/api\/media\/uploads\/acc-1\/[0-9a-f]{64}$/);
  });
});
