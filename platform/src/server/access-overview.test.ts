import { describe, expect, it } from "vitest";
import type { ApiKeyView } from "../core/api-keys";
import type { JobRecord } from "../core/repository";
import { buildAccessOverview } from "./access-overview";

const ACC = "00000000-0000-4000-8000-000000000001";
const KEY: ApiKeyView = { id: "10000000-0000-4000-8000-000000000001", kind: "key", name: "Tevyon CLI · MacBook", prefix: "tch_AbCdEf", dailyLimit: 300, createdAt: 1, lastUsedAt: 5 };
const APP: ApiKeyView = { id: "20000000-0000-4000-8000-000000000002", kind: "oauth", name: "Claude Code", prefix: "OAuth", dailyLimit: null, createdAt: 2, lastUsedAt: null };

function job(id: string, over: Partial<JobRecord>): JobRecord {
  return {
    id, accountId: ACC, jobType: "flux_3_image", model: "Seedream 4.5", status: "succeeded", credits: 7, params: { prompt: "a fox" },
    outputs: [{ url: `/api/media/${id}/0.png`, contentType: "image/png" }], createdAt: 100, unreachable: 0,
    providerParams: { prompt: "written by the skill" }, handle: "vendor-task-123", ...over,
  } as JobRecord;
}

describe("access overview", () => {
  it("adds each key's spend of the last 24 hours", () => {
    const o = buildAccessOverview({ keys: [KEY, APP], spent: { [KEY.id]: 32 }, jobs: [] });
    expect(o.keys).toEqual([{ ...KEY, spent24h: 32 }, { ...APP, spent24h: 0 }]);
  });

  it("lists what agents did, newest first, with the key or app that did it, never Studio jobs", () => {
    const o = buildAccessOverview({
      keys: [KEY, APP],
      spent: {},
      jobs: [
        job("j3", { origin: "mcp", apiKeyId: APP.id, createdAt: 300 }),
        job("j2", { origin: "web", createdAt: 200 }),
        job("j1", { origin: "cli", apiKeyId: KEY.id, createdAt: 100, jobType: "veo_3_1_lite", model: "Veo 3.1 Lite", outputs: [{ url: "/api/media/j1/0.mp4", contentType: "video/mp4" }] }),
      ],
    });
    expect(o.activity).toEqual([
      { id: "j3", jobType: "flux_3_image", model: "Seedream 4.5", status: "succeeded", credits: 7, origin: "mcp", keyId: APP.id, keyName: "Claude Code", createdAt: 300, preview: "/api/media/j3/0.png", media: "image", prompt: "a fox" },
      { id: "j1", jobType: "veo_3_1_lite", model: "Veo 3.1 Lite", status: "succeeded", credits: 7, origin: "cli", keyId: KEY.id, keyName: "Tevyon CLI · MacBook", createdAt: 100, preview: "/api/media/j1/0.mp4", media: "video", prompt: "a fox" },
    ]);
  });

  it("shows a failed job with its error and without a preview, and a revoked key without a name", () => {
    const o = buildAccessOverview({
      keys: [],
      spent: {},
      jobs: [job("j9", { origin: "api", apiKeyId: "30000000-0000-4000-8000-000000000003", status: "failed", error: "content_moderated", outputs: [] })],
    });
    expect(o.activity[0]).toMatchObject({ status: "failed", error: "content_moderated", preview: null, media: null, keyName: null });
  });

  it("shows a preset job by its preset and the user's wish, never the recipe prompt", () => {
    const params = { prompt: "SECRET RECIPE PROMPT Additional wish: red cape", image: "/api/media/uploads/a/b.png", recipe: { id: "superhero-pet", title: "Superheld", wish: "red cape" } };
    const o = buildAccessOverview({ keys: [KEY], spent: {}, jobs: [job("j5", { origin: "api", apiKeyId: KEY.id, params })] });
    expect(o.activity[0]).toMatchObject({ preset: "Superheld", prompt: "red cape" });
    expect(JSON.stringify(o)).not.toContain("SECRET RECIPE PROMPT");
  });

  it("keeps at most the latest twelve and never carries vendor details", () => {
    const jobs = Array.from({ length: 20 }, (_, i) => job(`j${i}`, { origin: "mcp", apiKeyId: APP.id, createdAt: 1000 - i }));
    const o = buildAccessOverview({ keys: [APP], spent: {}, jobs });
    expect(o.activity).toHaveLength(12);
    const json = JSON.stringify(o);
    expect(json).not.toContain("vendor-task-123");
    expect(json).not.toContain("written by the skill");
  });
});
