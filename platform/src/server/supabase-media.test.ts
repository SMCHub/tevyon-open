import { describe, expect, it } from "vitest";
import { createSupabaseMediaStore } from "./supabase-media";

const BASE = "https://proj.supabase.co";
const KEY = "sb_secret_test";

/** A minimal Supabase Storage: upload, download with Range, HEAD. Records every request. */
function fakeStorage() {
  const files = new Map<string, { data: Uint8Array; type: string }>();
  const calls: { method: string; path: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, path: url.pathname, headers });
    if (headers.get("apikey") !== KEY) return new Response("unauthorized", { status: 401 });
    const sign = /^\/storage\/v1\/object\/sign\/media\/(.+)$/.exec(url.pathname);
    if (method === "POST" && sign) {
      const key = decodeURIComponent(sign[1]!);
      if (!files.has(key)) return Response.json({ error: "not_found" }, { status: 400 });
      const { expiresIn } = JSON.parse(String(init!.body)) as { expiresIn: number };
      return Response.json({ signedURL: `/object/sign/media/${key}?token=tok-${expiresIn}` });
    }
    if (method === "POST" && url.pathname === "/storage/v1/object/list/media") {
      const body = JSON.parse(String(init!.body)) as { prefix: string; limit: number; sortBy: { column: string; order: string } };
      const folder = `${body.prefix.replace(/\/$/, "")}/`;
      const names = [...files.keys()].filter((k) => k.startsWith(folder) && !k.slice(folder.length).includes("/"));
      // Insertion order is upload order; the store asks for newest first.
      const rows = names.map((k, i) => ({ name: k.slice(folder.length), created_at: new Date(1_700_000_000_000 + i * 1000).toISOString(), metadata: { mimetype: files.get(k)!.type } }));
      if (body.sortBy.column === "created_at" && body.sortBy.order === "desc") rows.reverse();
      return Response.json(rows.slice(0, body.limit));
    }
    const m = /^\/storage\/v1\/object\/media\/(.+)$/.exec(url.pathname);
    if (!m) return new Response("no route", { status: 404 });
    const key = decodeURIComponent(m[1]!);
    if (method === "POST") {
      files.set(key, { data: new Uint8Array(await new Response(init!.body as BodyInit).arrayBuffer()), type: headers.get("content-type") ?? "" });
      return Response.json({ Key: `media/${key}` });
    }
    const f = files.get(key);
    if (!f) return Response.json({ error: "not_found" }, { status: 400 });
    if (method === "HEAD") return new Response(null, { headers: { "content-length": String(f.data.length), "content-type": f.type } });
    const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") ?? "");
    if (range) {
      const [s, e] = [Number(range[1]), Number(range[2])];
      return new Response(f.data.slice(s, e + 1) as unknown as BodyInit, { status: 206, headers: { "content-type": f.type } });
    }
    return new Response(f.data as unknown as BodyInit, { headers: { "content-type": f.type, "content-length": String(f.data.length) } });
  };
  return { files, calls, fetchImpl };
}

const bytes = (s: string) => new TextEncoder().encode(s);
const text = async (s: ReadableStream<Uint8Array>) => new Response(s).text();

describe("supabase media store", () => {
  it("stores under the key with its extension and returns the same URL as the file store", async () => {
    const st = fakeStorage();
    const media = createSupabaseMediaStore({ url: BASE, secretKey: KEY, fetch: st.fetchImpl });
    const url = await media.put("uploads/acc/abc", bytes("PNGDATA"), "image/png");
    expect(url).toBe("/api/media/uploads/acc/abc.png");
    expect(st.files.get("uploads/acc/abc.png")?.type).toBe("image/png");
    const upload = st.calls.find((c) => c.method === "POST")!;
    expect(upload.headers.get("x-upsert")).toBe("true");
  });

  it("signs a short-lived https link to a stored file (video inputs go to the vendor as links)", async () => {
    const st = fakeStorage();
    const media = createSupabaseMediaStore({ url: BASE, secretKey: KEY, fetch: st.fetchImpl });
    const url = await media.put("uploads/acc/clip_5s", bytes("MP4"), "video/mp4");
    expect(await media.signedUrl(url, 900)).toBe(`${BASE}/storage/v1/object/sign/media/uploads/acc/clip_5s.mp4?token=tok-900`);
    expect(await media.signedUrl("/api/media/uploads/acc/missing.mp4", 900)).toBeUndefined();
    expect(await media.signedUrl("/api/media/../secret", 900)).toBeUndefined();
  });

  it("lists the files under a folder, newest first, as media URLs", async () => {
    const st = fakeStorage();
    const media = createSupabaseMediaStore({ url: BASE, secretKey: KEY, fetch: st.fetchImpl });
    await media.put("uploads/acc/a", bytes("1"), "image/png");
    await media.put("uploads/acc/b_6s", bytes("2"), "video/mp4");
    await media.put("uploads/other/c", bytes("3"), "image/png");
    expect(await media.list("uploads/acc", 10)).toEqual([
      { url: "/api/media/uploads/acc/b_6s.mp4", kind: "video", at: 1_700_000_001_000 },
      { url: "/api/media/uploads/acc/a.png", kind: "image", at: 1_700_000_000_000 },
    ]);
    expect(await media.list("../acc", 10)).toEqual([]);
  });

  it("reads a file back whole", async () => {
    const st = fakeStorage();
    const media = createSupabaseMediaStore({ url: BASE, secretKey: KEY, fetch: st.fetchImpl });
    await media.put("job1/0", bytes("hello"), "image/webp");
    const got = await media.read("job1/0.webp");
    expect(got && new TextDecoder().decode(got.data)).toBe("hello");
    expect(got?.contentType).toBe("image/webp");
    expect(await media.read("job1/missing.webp")).toBeUndefined();
  });

  it("opens a file with its size and streams byte ranges (video seeking)", async () => {
    const st = fakeStorage();
    const media = createSupabaseMediaStore({ url: BASE, secretKey: KEY, fetch: st.fetchImpl });
    await media.put("job2/0", bytes("0123456789"), "video/mp4");
    const file = await media.open("job2/0.mp4");
    expect(file).toMatchObject({ size: 10, contentType: "video/mp4" });
    expect(await text(file!.stream({ start: 2, end: 5 }))).toBe("2345");
    expect(await text(file!.stream())).toBe("0123456789");
    expect(await media.open("job2/none.mp4")).toBeUndefined();
  });

  it("refuses keys that leave the store", async () => {
    const st = fakeStorage();
    const media = createSupabaseMediaStore({ url: BASE, secretKey: KEY, fetch: st.fetchImpl });
    expect(await media.open("../secret")).toBeUndefined();
    expect(await media.read("a/../../b")).toBeUndefined();
    expect(st.calls).toHaveLength(0);
  });

  it("fails loudly when an upload is refused, so the worker retries storing", async () => {
    const media = createSupabaseMediaStore({ url: BASE, secretKey: "wrong", fetch: fakeStorage().fetchImpl });
    await expect(media.put("x/0", bytes("a"), "image/png")).rejects.toThrow(/storage upload failed: 401/);
  });
});
