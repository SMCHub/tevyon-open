import { describe, expect, it } from "vitest";
import { createChatUploadScanner } from "./upload-scanner";

function fakeFetch(answer: { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const reply = (content: string, finish_reason = "stop") => ({ choices: [{ finish_reason, message: { content } }] });
const image = { data: new Uint8Array([1, 2, 3]), contentType: "image/png" };
const video = { data: new Uint8Array([4, 5, 6]), contentType: "video/mp4" };

describe("upload scanner (router chat route)", () => {
  it("allows what the model finds harmless", async () => {
    const { f } = fakeFetch({ body: reply(JSON.stringify({ allowed: true, category: "none" })) });
    expect(await createChatUploadScanner({ apiKey: "k", fetch: f }).scan(image)).toEqual({ allowed: true });
  });

  it("blocks with the category the model names", async () => {
    const { f } = fakeFetch({ body: reply(JSON.stringify({ allowed: false, category: "nudity" })) });
    expect(await createChatUploadScanner({ apiKey: "k", fetch: f }).scan(image)).toEqual({ allowed: false, category: "nudity" });
  });

  it("sends an image as an image and a video as a video, inline, with no training on it", async () => {
    const { f, calls } = fakeFetch({ body: reply(JSON.stringify({ allowed: true, category: "none" })) });
    const scanner = createChatUploadScanner({ apiKey: "k", fetch: f, model: "scan/model-1" });
    await scanner.scan(image);
    await scanner.scan(video);
    const first = JSON.parse(String(calls[0]?.init.body));
    const second = JSON.parse(String(calls[1]?.init.body));
    expect(first.model).toBe("scan/model-1");
    expect(first.provider).toEqual({ data_collection: "deny" });
    expect(JSON.stringify(first.messages)).toContain("data:image/png;base64,AQID");
    expect(JSON.stringify(second.messages)).toContain('"video_url"');
    expect(JSON.stringify(second.messages)).toContain("data:video/mp4;base64,BAUG");
  });

  it("never asks who a person is (no biometric identification)", async () => {
    const { f, calls } = fakeFetch({ body: reply(JSON.stringify({ allowed: true, category: "none" })) });
    await createChatUploadScanner({ apiKey: "k", fetch: f }).scan(image);
    const system = JSON.parse(String(calls[0]?.init.body)).messages[0].content as string;
    expect(system).toMatch(/never identify/i);
  });

  it("treats a refusal by the model's own safety filter as blocked, not as a failure to retry", async () => {
    const filtered = fakeFetch({ body: reply("", "content_filter") });
    expect(await createChatUploadScanner({ apiKey: "k", fetch: filtered.f }).scan(image)).toEqual({ allowed: false, category: "other" });
    const flagged = fakeFetch({ status: 403, body: { error: { code: 403, message: "Input was flagged", metadata: { reasons: ["sexual"] } } } });
    expect(await createChatUploadScanner({ apiKey: "k", fetch: flagged.f }).scan(image)).toEqual({ allowed: false, category: "other" });
    const policy = fakeFetch({ status: 403, body: { error_type: "content_policy_violation", detail: "flagged" } });
    expect(await createChatUploadScanner({ apiKey: "k", fetch: policy.f }).scan(image)).toEqual({ allowed: false, category: "other" });
  });

  it("does not take our own account trouble (a key without access, no credits) for a verdict on the file", async () => {
    for (const errorType of ["forbidden", "not_enabled", "unauthorized", "insufficient_credits"]) {
      const account = fakeFetch({ status: 403, body: { error_type: errorType, detail: "x" } });
      await expect(createChatUploadScanner({ apiKey: "k", fetch: account.f }).scan(image)).rejects.toThrow();
    }
  });

  it("throws when the answer is unusable, so the upload is refused rather than let through", async () => {
    const broken = fakeFetch({ body: reply("maybe") });
    await expect(createChatUploadScanner({ apiKey: "k", fetch: broken.f }).scan(image)).rejects.toThrow();
    const down = fakeFetch({ status: 502, body: { error: { message: "bad gateway" } } });
    await expect(createChatUploadScanner({ apiKey: "k", fetch: down.f }).scan(image)).rejects.toThrow();
  });

  it("maps an unknown category of a block to “other” and still blocks", async () => {
    const { f } = fakeFetch({ body: reply(JSON.stringify({ allowed: false, category: "weird" })) });
    expect(await createChatUploadScanner({ apiKey: "k", fetch: f }).scan(image)).toEqual({ allowed: false, category: "other" });
  });
});
