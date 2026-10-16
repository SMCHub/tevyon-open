import { describe, expect, it } from "vitest";
import { createComfyProvider } from "./comfy";

type Call = { method: string; url: string; headers: Record<string, string>; body?: string };

/** A scripted Comfy Router: answers by method and path, records every call. */
function router(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, ...(init?.body ? { body: String(init.body) } : {}) });
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`unexpected ${method} ${url}`);
    return route();
  };
  return { fetch: fetchImpl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const bytes = (data: number[], contentType: string) => new Response(new Uint8Array(data), { status: 200, headers: { "content-type": contentType } });

const BASE = "https://api.comfy.org/v2/models/bfl/flux-3/requests";
const img = { kind: "image" as const, providerModel: "bfl/flux-3", params: { prompt: "a red fox in snow" } };

describe("Comfy Router provider", () => {
  it("queues a job with the model's own input and comes back with a handle", async () => {
    const r = router({ [`POST ${BASE}`]: () => json({ request_id: "req-1", status: "IN_QUEUE" }, 202) });
    const comfy = createComfyProvider({ apiKey: "ck-test", fetch: r.fetch });

    expect(await comfy.submit(img)).toEqual({ state: "pending", handle: "bfl/flux-3:req-1" });
    expect(r.calls[0]).toMatchObject({ method: "POST", url: BASE, body: JSON.stringify({ prompt: "a red fox in snow" }) });
    expect(r.calls[0]!.headers.Authorization).toBe("Bearer ck-test");
  });

  it("sends our own media as data URLs, since the router cannot reach this server", async () => {
    const r = router({ [`POST ${BASE}`]: () => json({ request_id: "req-1" }, 202) });
    const comfy = createComfyProvider({
      apiKey: "k", fetch: r.fetch,
      loadMedia: async (url) => (url === "/api/media/uploads/acc/a.png" ? { data: new Uint8Array([1, 2]), contentType: "image/png" } : undefined),
    });
    await comfy.submit({ ...img, params: { prompt: "x", image_url: "/api/media/uploads/acc/a.png", refs: ["/api/media/uploads/acc/a.png"] } });
    expect(JSON.parse(r.calls[0]!.body!)).toEqual({ prompt: "x", image_url: "data:image/png;base64,AQI=", refs: ["data:image/png;base64,AQI="] });

    const missing = await comfy.submit({ ...img, params: { prompt: "x", image_url: "/api/media/uploads/acc/gone.png" } });
    expect(missing).toMatchObject({ state: "failed", reason: "invalid_request" });
  });

  it("fills an inline-bytes marker with the file's bytes and type (Veo's start image)", async () => {
    const r = router({ [`POST ${BASE}`]: () => json({ request_id: "req-1" }, 202) });
    const comfy = createComfyProvider({
      apiKey: "k", fetch: r.fetch,
      loadMedia: async (url) => (url === "/api/media/uploads/acc/a.png" ? { data: new Uint8Array([1, 2]), contentType: "image/png" } : undefined),
    });
    await comfy.submit({ ...img, params: { instances: [{ prompt: "x", image: { $inlineBase64: "/api/media/uploads/acc/a.png" } }] } });
    expect(JSON.parse(r.calls[0]!.body!)).toEqual({ instances: [{ prompt: "x", image: { bytesBase64Encoded: "AQI=", mimeType: "image/png" } }] });

    const missing = await comfy.submit({ ...img, params: { image: { $inlineBase64: "/api/media/uploads/acc/gone.png" } } });
    expect(missing).toMatchObject({ state: "failed", reason: "invalid_request" });
    expect(r.calls).toHaveLength(1);
  });

  it("retries what the router surely did not take, and never sends a job twice once it may have", async () => {
    const busy = router({ [`POST ${BASE}`]: () => json({ error_type: "rate_limited" }, 429) });
    await expect(createComfyProvider({ apiKey: "k", fetch: busy.fetch }).submit(img)).rejects.toThrow();

    const bad = router({ [`POST ${BASE}`]: () => json({ error_type: "invalid_input", detail: "prompt too long" }, 422) });
    expect(await createComfyProvider({ apiKey: "k", fetch: bad.fetch }).submit(img)).toMatchObject({ state: "failed", reason: "invalid_request" });

    const lost = router({ [`POST ${BASE}`]: () => { throw new TypeError("socket hang up"); } });
    expect(await createComfyProvider({ apiKey: "k", fetch: lost.fetch }).submit(img)).toMatchObject({ state: "failed", reason: "provider_error" });
  });

  it("waits while queued, then downloads every image and video the result names", async () => {
    let done = false;
    const r = router({
      [`GET ${BASE}/req-1/status`]: () => json(done ? { status: "COMPLETED" } : { status: "IN_PROGRESS" }),
      [`GET ${BASE}/req-1`]: () => json({ images: [{ url: "https://cdn.test/a.png" }], video: { url: "https://cdn.test/b.mp4" }, seed: 7 }),
      ["GET https://cdn.test/a.png"]: () => bytes([1], "image/png"),
      ["GET https://cdn.test/b.mp4"]: () => bytes([2, 3], "video/mp4"),
    });
    const comfy = createComfyProvider({ apiKey: "k", fetch: r.fetch });

    expect(await comfy.poll("bfl/flux-3:req-1")).toEqual({ state: "pending", handle: "bfl/flux-3:req-1" });
    done = true;
    const res = await comfy.poll("bfl/flux-3:req-1");
    expect(res).toEqual({
      state: "completed",
      outputs: [{ contentType: "image/png", data: new Uint8Array([1]) }, { contentType: "video/mp4", data: new Uint8Array([2, 3]) }],
    });
    // The key never goes to the file host.
    expect(r.calls.find((c) => c.url.startsWith("https://cdn.test"))!.headers.Authorization).toBeUndefined();
  });

  it("keeps inline (base64) videos, and skips watermarked copies and thumbnails", async () => {
    const r = router({
      [`GET ${BASE}/req-1/status`]: () => json({ status: "COMPLETED" }),
      [`GET ${BASE}/req-1`]: () => json({
        response: { videos: [{ bytesBase64Encoded: "AQID", mimeType: "video/mp4" }] },
        data: { task_result: { videos: [{ url: "https://cdn.test/v.mp4", watermark_url: "https://cdn.test/v-wm.mp4", cover_image_url: "https://cdn.test/c.jpg" }] } },
      }),
      ["GET https://cdn.test/v.mp4"]: () => bytes([9], "video/mp4"),
    });
    const res = await createComfyProvider({ apiKey: "k", fetch: r.fetch }).poll("bfl/flux-3:req-1");
    expect(res).toEqual({
      state: "completed",
      outputs: [{ contentType: "video/mp4", data: new Uint8Array([1, 2, 3]) }, { contentType: "video/mp4", data: new Uint8Array([9]) }],
    });
  });

  it("turns a completion with an error into our own failure codes", async () => {
    const outcome = async (errorType: string, where: "status" | "result") => {
      const r = router({
        [`GET ${BASE}/req-1/status`]: () => json(where === "status" ? { status: "COMPLETED", error_type: errorType } : { status: "COMPLETED" }),
        [`GET ${BASE}/req-1`]: () => json({ error_type: errorType, detail: "vendor text" }),
      });
      return createComfyProvider({ apiKey: "k", fetch: r.fetch }).poll("bfl/flux-3:req-1");
    };
    expect(await outcome("content_policy_violation", "status")).toMatchObject({ state: "failed", reason: "moderated" });
    expect(await outcome("invalid_input", "result")).toMatchObject({ state: "failed", reason: "invalid_request" });
    expect(await outcome("provider_timeout", "status")).toMatchObject({ state: "failed", reason: "timeout" });
    expect(await outcome("internal_error", "status")).toMatchObject({ state: "failed", reason: "provider_error" });
  });

  it("asks again later when a status read fails, since reading twice costs nothing", async () => {
    const r = router({ [`GET ${BASE}/req-1/status`]: () => json({ error_type: "service_unavailable" }, 503) });
    await expect(createComfyProvider({ apiKey: "k", fetch: r.fetch }).poll("bfl/flux-3:req-1")).rejects.toThrow();
    await expect(createComfyProvider({ apiKey: "k", fetch: r.fetch }).poll("not-a-handle")).resolves.toMatchObject({ state: "failed" });
  });
});
