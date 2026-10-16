import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createConsent, createMemoryConsentStore } from "./consent";
import { createJobs } from "./jobs";
import { createMemoryMediaStore } from "./media";
import { createPrompting, type PromptWriter } from "./prompting";
import { defineSkills } from "./skills";
import { createFakeProvider } from "./testing/fake-provider";
import { defineRegister, jobType } from "./register";
import { createMemoryRepository } from "./repository";
import { repositories } from "./testing/repositories";

const register = defineRegister([
  jobType({
    jobType: "test_image",
    kind: "image",
    model: "Test Image 1",
    tagline: "Test vendor · for the job tests",
    params: z.object({ prompt: z.string().min(1), count: z.number().int().min(1).max(4).default(1), image: z.string().optional(), references: z.array(z.string()).optional() }),
    credits: (p) => 2 * p.count,
    route: { provider: "fake", providerModel: "vendor/test-image-1" },
  }),
  jobType({
    jobType: "test_recast",
    kind: "video",
    model: "Test Recast",
    tagline: "Test vendor · reference video",
    params: z.object({ prompt: z.string().min(1), video: z.string(), references: z.array(z.string()) }),
    credits: () => 3,
    vendorParams: (p) => ({ prompt: `RECIPE ${p.prompt}`, reference_video: p.video, references: p.references }),
    route: { provider: "fake", providerModel: "vendor/test-video-1" },
  }),
]);

// Every job type needs its prompt skill (no generation without one).
const skills = defineSkills([{
  name: "prompt-test", version: "1.0.0", kind: "prompt", models: ["test_image", "test_recast"], description: "Prompts for the test model.",
  body: "# Test model\n\nSubject first.", rules: { maxChars: 400, minWords: 2, negations: "ok", slots: ["subject"] },
}], register);

/** A writer that counts its calls and answers with a fixed prompt. */
function fakeWriter(answer = "A red fox in fresh snow, soft morning light, skill wording 7f3a") {
  const writer: PromptWriter & { calls: number } = { calls: 0, write: async () => { writer.calls++; return answer; } };
  return writer;
}

const ACC_1 = "00000000-0000-4000-8000-000000000001";
const ACC_2 = "00000000-0000-4000-8000-000000000002";

describe.each(repositories)("jobs on %s repository", (_name, makeRepo) => {
async function setup({ credits = 10, log, writer, warn, label, refused }: {
  credits?: number; log?: Parameters<typeof createJobs>[0]["log"]; writer?: PromptWriter; warn?: (m: string) => void;
  label?: (data: Uint8Array, contentType: string) => Uint8Array; refused?: Parameters<typeof createJobs>[0]["refused"];
} = {}) {
  const repo = await makeRepo();
  await repo.grant(ACC_1, credits, "grant_1");
  const fake = createFakeProvider();
  const media = createMemoryMediaStore("https://media.tachyon.test");
  const prompting = createPrompting({ register, skills, writer });
  const jobs = createJobs({
    register, repo, providers: { fake }, media, prompting, ...(log ? { log } : {}), ...(warn ? { warn } : {}), ...(label ? { label } : {}), ...(refused ? { refused } : {}),
  });
  return { jobs, repo, fake, media, prompting };
}

describe("lookup", () => {
  it("finds no job behind an id that is not one (a media path like _models/x), instead of failing in the database", async () => {
    const { jobs, repo } = await setup();
    for (const id of ["_models", "foo", "------------------------------------"]) {
      expect(await repo.get(id)).toBeUndefined();
      expect(await jobs.get(ACC_1, id)).toBeUndefined();
    }
  });
});

describe("quote", () => {
  it("shows the credit price for a job before it starts", async () => {
    const { jobs } = await setup();
    expect(jobs.quote("test_image", { prompt: "a fox", count: 3 })).toMatchObject({ ok: true, credits: 6 });
  });

  it("rejects an unknown job type with its own error code", async () => {
    const { jobs } = await setup();
    expect(jobs.quote("nope", { prompt: "x" })).toEqual({ ok: false, error: "unknown_job_type" });
  });

  it("rejects invalid parameters with its own error code", async () => {
    const { jobs } = await setup();
    expect(jobs.quote("test_image", { prompt: "", count: 9 })).toMatchObject({ ok: false, error: "invalid_params" });
  });
});

describe("start", () => {
  it("reserves the quoted credits and queues the job", async () => {
    const { jobs, repo } = await setup({ credits: 10 });
    const res = await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 });
    expect(res).toMatchObject({ ok: true, job: { status: "queued", jobType: "test_image", credits: 6 } });
    expect(await repo.balance(ACC_1)).toBe(4);
  });

  it("does not start a job the account cannot pay for", async () => {
    const { jobs, repo } = await setup({ credits: 5 });
    expect(await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 })).toEqual({ ok: false, error: "insufficient_credits" });
    expect(await repo.balance(ACC_1)).toBe(5);
  });

  it("starts nothing and names the current price when it is higher than the price the caller agreed to", async () => {
    const { jobs, repo } = await setup({ credits: 10 });

    expect(await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 }, { maxCredits: 4 })).toEqual({ ok: false, error: "price_changed", credits: 6 });
    expect(await repo.balance(ACC_1)).toBe(10);
    expect(await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 }, { maxCredits: 6 })).toMatchObject({ ok: true, job: { credits: 6 } });
  });

  it("tells the operator overview about every start it turns away, never about a started job or a replay", async () => {
    const turnedAway: { jobType: string; origin: string; error: string }[] = [];
    const { jobs } = await setup({ credits: 10, refused: (r) => void turnedAway.push(r) });

    await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 }, { maxCredits: 4, origin: "mcp" });
    await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 9 }, { origin: "cli" });
    await jobs.start(ACC_1, "made_up_model", { prompt: "a fox" }, { origin: "api" });
    await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 }, { maxCredits: 6, origin: "mcp", idempotencyKey: "k1" });
    await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 }, { maxCredits: 6, origin: "mcp", idempotencyKey: "k1" });
    await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 });

    expect(turnedAway).toEqual([
      { jobType: "test_image", origin: "mcp", error: "price_changed" },
      { jobType: "test_image", origin: "cli", error: "invalid_params" },
      // Names nobody offers are not stored as they came: one bucket for all of them.
      { jobType: "(unknown)", origin: "api", error: "unknown_job_type" },
      { jobType: "test_image", origin: "web", error: "insufficient_credits" },
    ]);
  });

  it("remembers which channel and which API key started a job", async () => {
    const { jobs, repo } = await setup({ credits: 10 });
    const KEY = "20000000-0000-4000-8000-000000000001";

    const viaKey = await jobs.start(ACC_1, "test_image", { prompt: "a fox" }, { origin: "mcp", apiKeyId: KEY });
    const viaStudio = await jobs.start(ACC_1, "test_image", { prompt: "a fox" });
    if (!viaKey.ok || !viaStudio.ok) throw new Error("start failed");

    expect(await repo.get(viaKey.job.id)).toMatchObject({ origin: "mcp", apiKeyId: KEY });
    expect(await repo.get(viaStudio.job.id)).toMatchObject({ origin: "web" });
    expect((await repo.get(viaStudio.job.id))?.apiKeyId).toBeUndefined();
  });

  it("takes only the account's own uploads as input images, from every channel", async () => {
    const { jobs, repo } = await setup({ credits: 10 });
    for (const image of [
      `/api/media/uploads/${ACC_2}/a1b2.png`,
      `/api/media/uploads/${ACC_1}/../${ACC_2}/a1b2.png`,
      `/api/media/${ACC_2}-job/0.png`,
      "https://example.com/face.jpg",
    ]) {
      expect(await jobs.start(ACC_1, "test_image", { prompt: "a fox", image })).toMatchObject({ ok: false, error: "invalid_params" });
    }
    expect(await repo.balance(ACC_1)).toBe(10);
    expect(await jobs.start(ACC_1, "test_image", { prompt: "a fox", image: `/api/media/uploads/${ACC_1}/a1b2.png` })).toMatchObject({ ok: true });
  });

  it("takes only the account's own uploads as reference images, each one of them", async () => {
    const { jobs, repo } = await setup({ credits: 10 });
    const mine = `/api/media/uploads/${ACC_1}/a1b2.png`;
    for (const foreign of [`/api/media/uploads/${ACC_2}/a1b2.png`, "https://example.com/face.jpg", "face.jpg"]) {
      expect(await jobs.start(ACC_1, "test_image", { prompt: "a fox", references: [mine, foreign] })).toMatchObject({ ok: false, error: "invalid_params" });
    }
    expect(await repo.balance(ACC_1)).toBe(10);
    expect(await jobs.start(ACC_1, "test_image", { prompt: "a fox", references: [mine] })).toMatchObject({ ok: true });
  });

  it("starts nothing when the prompt names a reference image that is not attached, so no @-image is lost on the way", async () => {
    const { jobs, repo } = await setup({ credits: 10 });
    const mine = `/api/media/uploads/${ACC_1}/a1b2.png`;
    // Still uploading, removed, or the model takes no reference images at all.
    expect(await jobs.start(ACC_1, "test_image", { prompt: "the fox from @Bild1 in @Bild2", references: [mine] }))
      .toMatchObject({ ok: false, error: "invalid_params", issues: ["references: @Bild2 is not attached"] });
    expect(await jobs.start(ACC_1, "test_image", { prompt: "the fox from @Bild1" }))
      .toMatchObject({ ok: false, error: "invalid_params", issues: ["references: @Bild1 is not attached"] });
    expect(await jobs.start(ACC_1, "test_image", { prompt: "the fox from @image3 runs", references: [mine, mine] }))
      .toMatchObject({ ok: false, error: "invalid_params", issues: ["references: @Bild3 is not attached"] });
    expect(await repo.balance(ACC_1)).toBe(10);
    expect(await jobs.start(ACC_1, "test_image", { prompt: "the fox from @Bild1, style of @bild 1", references: [mine] })).toMatchObject({ ok: true });
  });
});

const PNG = new Uint8Array([137, 80, 78, 71]);

describe("worker", () => {
  it("marks every result as AI-made before it is stored (AI Act Art. 50)", async () => {
    const seen: string[] = [];
    const label = (data: Uint8Array, contentType: string) => {
      seen.push(contentType);
      return new Uint8Array([...data, 0x41, 0x49]);
    };
    const { jobs, fake, media } = await setup({ label });
    fake.next({ state: "completed", outputs: [{ contentType: "image/png", data: PNG }] });
    const started = await jobs.start(ACC_1, "test_image", { prompt: "a fox" });
    if (!started.ok) throw new Error(started.error);
    await jobs.tick();
    const job = await jobs.get(ACC_1, started.job.id);
    expect(seen).toEqual(["image/png"]);
    expect(media.read(job!.outputs[0]!.url)).toEqual(new Uint8Array([...PNG, 0x41, 0x49]));
  });

  it("delivers a finished job from Tachyon's own media store and keeps the credits spent", async () => {
    const { jobs, repo, fake, media } = await setup({ credits: 10 });
    fake.next({ state: "completed", outputs: [{ contentType: "image/png", data: PNG }] });
    const started = await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 });
    if (!started.ok) throw new Error(started.error);

    await jobs.tick();

    const job = await jobs.get(ACC_1, started.job.id);
    expect(job).toMatchObject({ status: "succeeded", credits: 6 });
    expect(job?.outputs).toHaveLength(1);
    expect(job?.outputs[0]?.url).toMatch(/^https:\/\/media\.tachyon\.test\//);
    expect(media.read(job!.outputs[0]!.url)).toEqual(PNG);
    expect(await repo.balance(ACC_1)).toBe(4);
  });

  it("keeps the provider's real cost of a finished job on the server, never in the job view", async () => {
    const { jobs, repo, fake } = await setup({ credits: 10 });
    fake.next({ state: "completed", outputs: [{ contentType: "image/png", data: PNG }], costUsd: 0.0425 });
    const started = await jobs.start(ACC_1, "test_image", { prompt: "a fox" });
    if (!started.ok) throw new Error(started.error);

    await jobs.tick();

    expect((await repo.get(started.job.id))?.costUsd).toBe(0.0425);
    const view = await jobs.get(ACC_1, started.job.id);
    expect(view).not.toHaveProperty("costUsd");
    expect(JSON.stringify([view, await jobs.list(ACC_1)])).not.toContain("0.0425");
  });

  it("keeps what the provider still charged for a failed job, while the user gets every credit back", async () => {
    const { jobs, repo, fake } = await setup({ credits: 10 });
    fake.next({ state: "failed", reason: "moderated", detail: "blocked after rendering", costUsd: 0.03 });
    const started = await jobs.start(ACC_1, "test_image", { prompt: "a fox" });
    if (!started.ok) throw new Error(started.error);

    await jobs.tick();

    expect(await repo.get(started.job.id)).toMatchObject({ status: "failed", costUsd: 0.03 });
    expect(await repo.balance(ACC_1)).toBe(10);
    expect(JSON.stringify(await jobs.get(ACC_1, started.job.id))).not.toContain("0.03");
  });

  it("refunds all credits when the provider moderates or fails the job", async () => {
    const { jobs, repo, fake } = await setup({ credits: 10 });
    fake.next({ state: "failed", reason: "moderated", detail: "vendor said: policy violation #4711" });
    const started = await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 3 });
    if (!started.ok) throw new Error(started.error);

    await jobs.tick();

    expect(await jobs.get(ACC_1, started.job.id)).toMatchObject({ status: "failed", error: "content_moderated", outputs: [] });
    expect(await repo.balance(ACC_1)).toBe(10);
  });

  it("follows a long-running job across worker passes until it finishes", async () => {
    const { jobs, repo, fake } = await setup({ credits: 10 });
    fake.next({ state: "pending", handle: "vendor-task-1" });
    fake.next({ state: "pending", handle: "vendor-task-1" });
    fake.next({ state: "completed", outputs: [{ contentType: "video/mp4", data: PNG }] });
    const started = await jobs.start(ACC_1, "test_image", { prompt: "a fox" });
    if (!started.ok) throw new Error(started.error);

    await jobs.tick();
    expect((await jobs.get(ACC_1, started.job.id))?.status).toBe("running");
    await jobs.tick();
    await jobs.tick();

    expect((await jobs.get(ACC_1, started.job.id))?.status).toBe("succeeded");
    expect(await repo.balance(ACC_1)).toBe(8);
  });
});

describe("public job view", () => {
  it("never reveals the provider, the vendor model ID, the vendor task, vendor messages or the written prompt", async () => {
    const { jobs, fake } = await setup({ credits: 10, writer: fakeWriter() });
    fake.next({ state: "pending", handle: "vendor-task-1" });
    fake.next({ state: "failed", reason: "provider_error", detail: "upstream https://vendor.example/x said no" });
    const started = await jobs.start(ACC_1, "test_image", { prompt: "a fox" });
    if (!started.ok) throw new Error(started.error);

    const seen = [JSON.stringify(started), JSON.stringify(jobs.quote("test_image", { prompt: "a fox" }))];
    await jobs.tick();
    seen.push(JSON.stringify(await jobs.get(ACC_1, started.job.id)));
    await jobs.tick();
    seen.push(JSON.stringify(await jobs.get(ACC_1, started.job.id)));

    for (const text of seen) {
      for (const secret of ["fake", "vendor/test-image-1", "vendor-task-1", "vendor.example", "said no", "skill wording 7f3a"]) {
        expect(text).not.toContain(secret);
      }
    }
  });
});

describe("idempotent start", () => {
  it("returns the same job and reserves once when a client retries with the same key", async () => {
    const { jobs, repo } = await setup({ credits: 10 });
    const a = await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 2 }, { idempotencyKey: "req-1" });
    const b = await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 2 }, { idempotencyKey: "req-1" });
    if (!a.ok || !b.ok) throw new Error("start failed");
    expect(b.job.id).toBe(a.job.id);
    expect(await repo.balance(ACC_1)).toBe(6);
  });
});

describe("unreachable provider", () => {
  it("retries a job while the provider is unreachable, with growing pauses, then fails it and refunds", async () => {
    const { repo, fake, media, prompting } = await setup({ credits: 10 });
    let t = Date.now();
    const jobs = createJobs({ register, repo, providers: { fake }, media, prompting, now: () => t });
    fake.failNextCalls(5);
    const started = await jobs.start(ACC_1, "test_image", { prompt: "a fox" });
    if (!started.ok) throw new Error(started.error);

    await jobs.tick();
    expect((await jobs.get(ACC_1, started.job.id))?.status).toBe("queued");
    for (let i = 0; i < 4; i++) {
      t += 75_000; // past the longest pause between tries (60 s + jitter)
      await jobs.tick();
    }

    expect(await jobs.get(ACC_1, started.job.id)).toMatchObject({ status: "failed", error: "generation_failed" });
    expect(await repo.balance(ACC_1)).toBe(10);
  });
});

describe("list", () => {
  it("lists only the account's own jobs, newest first", async () => {
    const { jobs, repo } = await setup({ credits: 10 });
    await repo.grant(ACC_2, 10, "grant_2");
    const a = await jobs.start(ACC_1, "test_image", { prompt: "first" });
    await jobs.start(ACC_2, "test_image", { prompt: "someone else" });
    const b = await jobs.start(ACC_1, "test_image", { prompt: "second" });
    if (!a.ok || !b.ok) throw new Error("start failed");
    expect((await jobs.list(ACC_1)).map((j) => j.id)).toEqual([b.job.id, a.job.id]);
  });
});

describe("operator log", () => {
  it("hands the raw provider detail to the server log, never to the job view", async () => {
    const events: unknown[] = [];
    const { jobs, fake } = await setup({ log: (e) => events.push(e) });
    fake.next({ state: "failed", reason: "invalid_request", detail: "resolution 1K not supported" });
    const started = await jobs.start(ACC_1, "test_image", { prompt: "a fox" });
    if (!started.ok) throw new Error(started.error);
    await jobs.tick();
    expect(events).toContainEqual(expect.objectContaining({ jobId: started.job.id, error: "invalid_request", detail: "resolution 1K not supported" }));
  });
});
describe("prompt skill", () => {
  it("shows in the quote which prompt skill runs and what could be better, without calling a model", async () => {
    const writer = fakeWriter();
    const { jobs } = await setup({ writer });
    const quote = jobs.quote("test_image", { prompt: "fox" });
    expect(quote).toEqual({
      ok: true, credits: 2,
      prompt: { skill: "prompt-test@1.0.0", notes: [expect.objectContaining({ code: "too_short", level: "info" })] },
    });
    expect(writer.calls).toBe(0);
  });

  it("sends the prompt written by the skill to the model and keeps the user's own words in the job", async () => {
    const { jobs, fake } = await setup({ writer: fakeWriter("A red fox in fresh snow, soft morning light") });
    const started = await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee", count: 2 });
    if (!started.ok) throw new Error(started.error);
    expect(started.job).toMatchObject({ params: { prompt: "fuchs im schnee", count: 2 }, promptSkill: "prompt-test@1.0.0" });

    await jobs.tick();

    expect(fake.requests[0]?.params).toEqual({ prompt: "A red fox in fresh snow, soft morning light", count: 2 });
    expect((await jobs.get(ACC_1, started.job.id))?.params.prompt).toBe("fuchs im schnee");
  });

  it("sends a recipe job the vendor params of its job type: own reference video and images in, recipe prompt added", async () => {
    const { jobs, fake } = await setup();
    const video = `/api/media/uploads/${ACC_1}/0a1b2c3d-0000-4000-8000-000000000001_12s.mp4`;
    const image = `/api/media/uploads/${ACC_1}/face.png`;
    const started = await jobs.start(ACC_1, "test_recast", { prompt: "on a rooftop at night", video, references: [image] }, { promptMode: "exact" });
    expect(started.ok).toBe(true);
    await jobs.tick();
    expect(fake.requests[0]?.params).toEqual({ prompt: "RECIPE on a rooftop at night", reference_video: video, references: [image] });
  });

  it("refuses someone else's reference video", async () => {
    const { jobs } = await setup();
    const video = `/api/media/uploads/${ACC_2}/0a1b2c3d-0000-4000-8000-000000000001_12s.mp4`;
    expect(await jobs.start(ACC_1, "test_recast", { prompt: "on a rooftop at night", video, references: [] }, { promptMode: "exact" })).toMatchObject({ ok: false, error: "invalid_params", issues: ["video: must be one of your uploads"] });
  });

  it("sends the caller's prompt as it is when the caller already applied the skill", async () => {
    const writer = fakeWriter();
    const { jobs, fake } = await setup({ writer });
    await jobs.start(ACC_1, "test_image", { prompt: "A red fox,   tracking shot" }, { promptMode: "exact" });
    await jobs.tick();
    expect(writer.calls).toBe(0);
    expect(fake.requests[0]?.params.prompt).toBe("A red fox, tracking shot");
  });

  it("writes the prompt once, even when a client retries with the same key", async () => {
    const writer = fakeWriter();
    const { jobs } = await setup({ writer });
    await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee" }, { idempotencyKey: "req-7" });
    await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee" }, { idempotencyKey: "req-7" });
    await jobs.tick(); // the worker writes the prompt, just before the job goes to the vendor
    expect(writer.calls).toBe(1);
  });

  it("does not spend a model call on a job the account cannot pay for", async () => {
    const writer = fakeWriter();
    const { jobs } = await setup({ credits: 1, writer });
    expect(await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee" })).toEqual({ ok: false, error: "insufficient_credits" });
    expect(writer.calls).toBe(0);
  });

  it("builds a final on its draft: same written prompt, new settings, nothing written again", async () => {
    const writer = fakeWriter("A red fox in fresh snow, soft morning light");
    const { jobs, fake } = await setup({ writer, credits: 20 });
    const draft = await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee", count: 1 });
    if (!draft.ok) throw new Error(draft.error);
    await jobs.tick(); // the draft is written and at the vendor
    const final = await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee", count: 3 }, { basedOn: draft.job.id });
    if (!final.ok) throw new Error(final.error);

    await jobs.tick();

    expect(writer.calls).toBe(1);
    expect(final.job.promptSkill).toBe("prompt-test@1.0.0");
    expect(fake.requests.map((r) => r.params)).toHaveLength(2);
    expect(fake.requests.map((r) => r.params)).toEqual(expect.arrayContaining([
      { prompt: "A red fox in fresh snow, soft morning light", count: 1 },
      { prompt: "A red fox in fresh snow, soft morning light", count: 3 },
    ]));
  });

  it("writes the prompt anew when the final changes the user's words", async () => {
    const writer = fakeWriter();
    const { jobs } = await setup({ writer, credits: 20 });
    const draft = await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee" });
    if (!draft.ok) throw new Error(draft.error);
    await jobs.tick();
    await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee bei nacht" }, { basedOn: draft.job.id });
    await jobs.tick();
    expect(writer.calls).toBe(2);
  });

  it("treats a draft id that is no job id like no draft at all", async () => {
    const writer = fakeWriter();
    const { jobs } = await setup({ writer });
    const res = await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee" }, { basedOn: "not-a-job-id'; drop table jobs; --" });
    expect(res).toMatchObject({ ok: true });
    await jobs.tick();
    expect(writer.calls).toBe(1);
  });

  it("does not let a final inherit the written prompt of a draft that failed", async () => {
    // A moderated draft's prompt would only be blocked again; the final gets a freshly written one.
    let n = 0;
    const writer: PromptWriter = { write: async () => `written prompt number ${++n}` };
    const { jobs, fake } = await setup({ writer, credits: 20 });
    fake.next({ state: "failed", reason: "moderated", detail: "policy" });
    const draft = await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee" });
    if (!draft.ok) throw new Error(draft.error);
    await jobs.tick();
    expect((await jobs.get(ACC_1, draft.job.id))?.status).toBe("failed");

    await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee" }, { basedOn: draft.job.id });
    await jobs.tick();

    expect(n).toBe(2);
    expect(fake.requests.at(-1)?.params.prompt).toBe("written prompt number 2");
  });

  it("never builds on a job of another account", async () => {
    let n = 0;
    const writer: PromptWriter = { write: async () => `written prompt number ${++n}` };
    const { jobs, repo, fake } = await setup({ writer });
    await repo.grant(ACC_2, 10, "grant_2");
    const foreign = await jobs.start(ACC_1, "test_image", { prompt: "fuchs im schnee" });
    if (!foreign.ok) throw new Error(foreign.error);
    const mine = await jobs.start(ACC_2, "test_image", { prompt: "fuchs im schnee" }, { basedOn: foreign.job.id });
    if (!mine.ok) throw new Error(mine.error);

    await jobs.tick();

    expect(fake.requests.map((r) => r.params.prompt)).toEqual(expect.arrayContaining(["written prompt number 1", "written prompt number 2"]));
  });

  it("keeps the written prompt with the job, so a worker after a restart submits the same prompt", async () => {
    const { repo, fake, media } = await setup();
    // The same server before and after a restart: same worker name, so it takes its own jobs back at once.
    const server = (writer: PromptWriter) =>
      createJobs({ register, repo, providers: { fake }, media, worker: { id: "server-1" }, prompting: createPrompting({ register, skills, writer }) });
    const before = server(fakeWriter("A red fox in fresh snow, soft morning light"));
    await before.start(ACC_1, "test_image", { prompt: "fuchs im schnee" });
    fake.failNextCalls(1);
    await before.tick(); // the prompt is written and stored, then the vendor cannot be reached

    const restarted = server(fakeWriter("A completely different prompt"));
    await restarted.tick();

    expect(fake.requests[0]?.params.prompt).toBe("A red fox in fresh snow, soft morning light");
  });
});

describe("daily limit of an API key", () => {
  const KEY_A = "20000000-0000-4000-8000-00000000000a";
  const KEY_B = "20000000-0000-4000-8000-00000000000b";
  const DAY = 86_400_000;
  // test_image costs 2 credits per image; the account has plenty, the key may spend 5 per 24 h.
  async function keyed() {
    const repo = await makeRepo();
    await repo.grant(ACC_1, 100, "grant_1");
    let clock = Date.parse("2026-10-13T08:00:00Z");
    const jobs = createJobs({
      register, repo, providers: { fake: createFakeProvider() }, media: createMemoryMediaStore("https://media.tachyon.test"),
      prompting: createPrompting({ register, skills }), now: () => clock,
    });
    const limit = { credits: 5, windowMs: DAY };
    const viaKey = (key = KEY_A) => jobs.start(ACC_1, "test_image", { prompt: "a fox" }, { origin: "mcp", apiKeyId: key, keyLimit: limit });
    return { jobs, repo, viaKey, later: (ms: number) => { clock += ms; } };
  }

  it("stops a key at its limit and starts nothing more", async () => {
    const { repo, viaKey } = await keyed();
    expect((await viaKey()).ok).toBe(true);
    expect((await viaKey()).ok).toBe(true);

    expect(await viaKey()).toEqual({ ok: false, error: "key_limit_reached", limit: 5, used: 4 });
    expect(await repo.balance(ACC_1)).toBe(96);
  });

  it("gives a refunded job's credits back to the key's allowance", async () => {
    const { repo, viaKey } = await keyed();
    const first = await viaKey();
    const second = await viaKey();
    if (!first.ok || !second.ok) throw new Error("start failed");
    await repo.fail(first.job.id, "generation_failed");

    expect((await viaKey()).ok).toBe(true);
  });

  it("counts only the last 24 hours", async () => {
    const { viaKey, later } = await keyed();
    await viaKey();
    await viaKey();
    later(DAY + 1);

    expect((await viaKey()).ok).toBe(true);
  });

  it("limits each key on its own and never counts Studio jobs", async () => {
    const { jobs, viaKey } = await keyed();
    await jobs.start(ACC_1, "test_image", { prompt: "a fox", count: 4 });
    await viaKey(KEY_A);
    await viaKey(KEY_A);

    expect((await viaKey(KEY_B)).ok).toBe(true);
  });

  it("lets only one of two simultaneous starts through when together they would pass the limit", async () => {
    const { viaKey } = await keyed();
    await viaKey();

    const results = await Promise.all([viaKey(), viaKey()]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "key_limit_reached", limit: 5 });
  });
});
});

// Recipe prompts stay on the server: a preset job shows its preset, never the recipe's prompt.
describe.each(repositories)("preset jobs on %s repository", (_name, makeRepo) => {
  async function setupPreset() {
    const repo = await makeRepo();
    await repo.grant(ACC_1, 10, "grant_1");
    const fake = createFakeProvider();
    const media = createMemoryMediaStore("https://media.tachyon.test");
    const prompting = createPrompting({ register, skills, writer: fakeWriter() });
    const jobs = createJobs({ register, repo, providers: { fake }, media, prompting });
    return { jobs, fake };
  }
  const SECRET = "Secret recipe wording: the person walks away from a huge explosion, debris, slow motion";
  const recipe = { id: "action-held", title: "Action-Held", wish: "im Regen" };

  it("hides the recipe prompt in every view and shows the preset instead", async () => {
    const { jobs } = await setupPreset();
    const started = await jobs.start(ACC_1, "test_image", { prompt: SECRET }, { promptMode: "exact", recipe });
    if (!started.ok) throw new Error("start failed");
    for (const v of [started.job, await jobs.get(ACC_1, started.job.id), (await jobs.list(ACC_1))[0]]) {
      expect(JSON.stringify(v)).not.toContain("Secret recipe wording");
      expect(v?.params.recipe).toEqual(recipe);
      expect(v?.params.prompt).toBeUndefined();
    }
  });

  it("still sends the full recipe prompt to the vendor, without the preset marker", async () => {
    const { jobs, fake } = await setupPreset();
    await jobs.start(ACC_1, "test_image", { prompt: SECRET }, { promptMode: "exact", recipe });
    await jobs.tick();
    expect(fake.requests[0]?.params.prompt).toBe(SECRET);
    expect(fake.requests[0]?.params).not.toHaveProperty("recipe");
  });

  it("keeps a normal job's own prompt visible", async () => {
    const { jobs } = await setupPreset();
    const started = await jobs.start(ACC_1, "test_image", { prompt: "my own fox" }, { promptMode: "exact" });
    expect(started.ok && started.job.params.prompt).toBe("my own fox");
  });
});

describe("consent for real people when an agent starts the job", () => {
  const swapRegister = defineRegister([
    jobType({
      jobType: "test_swap",
      kind: "image",
      model: "Test Swap",
      tagline: "Test vendor · face swap",
      params: z.object({ prompt: z.string().default(""), image: z.string(), face: z.string(), consent: z.literal(true) }),
      credits: () => 3,
      consentImages: (p) => [p.image, p.face],
      route: { provider: "fake", providerModel: "vendor/test-swap" },
    }),
  ]);
  const swapSkills = defineSkills([{
    name: "prompt-test", version: "1.0.0", kind: "prompt", models: ["test_swap"], description: "Prompts for the test swap.",
    body: "# Test swap", rules: { maxChars: 400, minWords: 0, negations: "ok", slots: ["subject"] },
  }], swapRegister);
  const target = `/api/media/uploads/${ACC_1}/target.png`;
  const face = `/api/media/uploads/${ACC_1}/face.png`;
  const params = { image: target, face, consent: true };

  async function swapSetup(credits = 20) {
    const plain = createMemoryRepository();
    await plain.grant(ACC_1, credits, "grant_swap");
    // The early balance check passes; create() refuses atomically, as when a parallel start took the credits.
    const repo = { ...plain, balance: async () => 20 };
    const consent = createConsent({ store: createMemoryConsentStore() });
    const jobs = createJobs({
      register: swapRegister, repo, providers: { fake: createFakeProvider() }, media: createMemoryMediaStore("https://media.tachyon.test"),
      prompting: createPrompting({ register: swapRegister, skills: swapSkills }), consent,
    });
    return { jobs, consent };
  }

  it("starts an agent's swap only with a consent the person confirmed in Tevyon, and only once", async () => {
    const { jobs, consent } = await swapSetup();
    // consent: true in the parameters is what an agent can type itself; it is not enough.
    expect(await jobs.start(ACC_1, "test_swap", params, { origin: "mcp", idempotencyKey: "a" })).toMatchObject({ ok: false, error: "consent_required" });
    const id = ((await consent.request(ACC_1, "test_swap", [target, face])) as { id: string }).id;
    expect(await jobs.start(ACC_1, "test_swap", params, { origin: "mcp", idempotencyKey: "a", consentId: id })).toMatchObject({ ok: false, error: "consent_pending" });
    await consent.confirm(ACC_1, id);
    const first = await jobs.start(ACC_1, "test_swap", params, { origin: "mcp", idempotencyKey: "a", consentId: id });
    expect(first).toMatchObject({ ok: true });
    const jobId = (first as { job: { id: string } }).job.id;
    // A retry of that start gets its job back; another job needs a new consent.
    expect(await jobs.start(ACC_1, "test_swap", params, { origin: "mcp", idempotencyKey: "a", consentId: id })).toMatchObject({ ok: true, job: { id: jobId } });
    expect(await jobs.start(ACC_1, "test_swap", params, { origin: "api", idempotencyKey: "b", consentId: id })).toMatchObject({ ok: false, error: "consent_used" });
    expect(await consent.view(ACC_1, id)).toMatchObject({ state: "used" });
  });

  it("keeps the consent when the start fails after all, so the agent can try again", async () => {
    const { jobs, consent } = await swapSetup(1); // 1 credit: the swap costs 3
    const id = ((await consent.request(ACC_1, "test_swap", [target, face])) as { id: string }).id;
    await consent.confirm(ACC_1, id);
    expect(await jobs.start(ACC_1, "test_swap", params, { origin: "api", consentId: id })).toMatchObject({ ok: false, error: "insufficient_credits" });
    expect(await consent.view(ACC_1, id)).toMatchObject({ state: "confirmed" });
  });

  it("binds the consent to its pictures", async () => {
    const { jobs, consent } = await swapSetup();
    const id = ((await consent.request(ACC_1, "test_swap", [target, face])) as { id: string }).id;
    await consent.confirm(ACC_1, id);
    const other = { ...params, face: `/api/media/uploads/${ACC_1}/someone-else.png` };
    expect(await jobs.start(ACC_1, "test_swap", other, { origin: "cli", idempotencyKey: "c", consentId: id })).toMatchObject({ ok: false, error: "consent_invalid" });
  });

  it("lets the Studio start it with the person's own tick", async () => {
    const { jobs } = await swapSetup();
    expect(await jobs.start(ACC_1, "test_swap", params, { idempotencyKey: "w" })).toMatchObject({ ok: true });
  });
});

