import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { JobView } from "./jobs";
import { createMemoryMediaStore } from "./media";
import { reuseOutput } from "./reuse";

const ACC = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup() {
  const media = createMemoryMediaStore("/api/media");
  const jobs = new Map<string, JobView & { accountId: string }>();
  const add = async (id: string, accountId: string, patch: Partial<JobView> = {}, data: Uint8Array = PNG, contentType = "image/png") => {
    const url = await media.put(`${id}/0`, data, contentType);
    jobs.set(id, { id, accountId, jobType: "flux_3_image", model: "Seedream 4.5", status: "succeeded", credits: 10, outputs: [{ url, contentType }], params: { prompt: "x" }, createdAt: 0, ...patch });
  };
  const deps = {
    getJob: async (accountId: string, jobId: string) => {
      const j = jobs.get(jobId);
      return j && j.accountId === accountId ? j : undefined;
    },
    read: async (url: string) => media.read(url),
    media,
  };
  return { deps, add, media };
}

describe("reuse a result as a reference image", () => {
  it("copies the account's own finished image into its uploads, so it passes as an input like any upload", async () => {
    const { deps, add, media } = setup();
    await add("job-1", ACC);

    const res = await reuseOutput(deps, ACC, "job-1", 0);

    expect(res).toMatchObject({ ok: true });
    const url = (res as { url: string }).url;
    expect(url).toMatch(new RegExp(`^/api/media/uploads/${ACC}/[0-9a-f]{64}$`));
    expect(media.read(url)).toEqual(PNG);
    // The same result taken twice is the same upload, not a second copy.
    expect(await reuseOutput(deps, ACC, "job-1", 0)).toEqual(res);
  });

  it("copies a finished video too, with its length in the name like an uploaded clip", async () => {
    const { deps, add } = setup();
    const clip = new Uint8Array(readFileSync(path.join(import.meta.dirname, "testing/fixtures/video", "sample-5s.mov")));
    await add("clip", ACC, {}, clip, "video/mp4");
    const res = await reuseOutput(deps, ACC, "clip", 0);
    expect(res.ok && res.url).toMatch(/-64x64_5s$/);
  });

  it("refuses someone else's job, unfinished jobs, missing outputs and anything that is not a raster image", async () => {
    const { deps, add } = setup();
    await add("theirs", OTHER);
    await add("running", ACC, { status: "running", outputs: [] });
    await add("video", ACC, {}, new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), "video/mp4");
    await add("svg", ACC, {}, new TextEncoder().encode("<svg onload=alert(1)>"), "image/svg+xml");
    await add("mine", ACC);

    expect(await reuseOutput(deps, ACC, "theirs", 0)).toEqual({ ok: false, error: "not_found" });
    expect(await reuseOutput(deps, ACC, "running", 0)).toEqual({ ok: false, error: "not_found" });
    expect(await reuseOutput(deps, ACC, "mine", 3)).toEqual({ ok: false, error: "not_found" });
    expect(await reuseOutput(deps, ACC, "video", 0)).toEqual({ ok: false, error: "not_an_image" });
    expect(await reuseOutput(deps, ACC, "svg", 0)).toEqual({ ok: false, error: "not_an_image" });
  });
});
