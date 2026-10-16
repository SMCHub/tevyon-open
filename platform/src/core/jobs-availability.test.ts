import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Availability } from "./availability";
import { createJobs } from "./jobs";
import { createMemoryMediaStore } from "./media";
import { createPrompting } from "./prompting";
import { defineRegister, jobType } from "./register";
import { createMemoryRepository } from "./repository";
import { defineSkills } from "./skills";
import { createFakeProvider } from "./testing/fake-provider";

const register = defineRegister(
  ["test_old", "test_new"].map((id) =>
    jobType({
      jobType: id,
      kind: "image",
      model: id === "test_old" ? "Test Image 1" : "Test Image 2",
      tagline: "Test vendor · for the availability tests",
      params: z.object({ prompt: z.string().min(1) }),
      credits: () => 3,
      route: { provider: "fake", providerModel: `vendor/${id}` },
    }),
  ),
);
const skills = defineSkills([{
  name: "prompt-test", version: "1.0.0", kind: "prompt", models: ["test_old", "test_new"], description: "Prompts for the test models.",
  body: "# Test", rules: { maxChars: 400, minWords: 1, negations: "ok", slots: ["subject"] },
}], register);

const ACC = "00000000-0000-4000-8000-000000000001";

async function setup(initial: Record<string, Availability> = {}) {
  const states: Record<string, Availability> = { ...initial };
  const repo = createMemoryRepository();
  await repo.grant(ACC, 10, "grant_1");
  const fake = createFakeProvider();
  const jobs = createJobs({
    register, repo, providers: { fake }, media: createMemoryMediaStore("https://media.tachyon.test"),
    prompting: createPrompting({ register, skills }),
    availability: (jt) => states[jt] ?? { ok: true, status: "active" },
  });
  return { jobs, repo, fake, states };
}

describe("model availability", () => {
  it("neither quotes nor starts a paused model, and reserves no credits", async () => {
    const { jobs, repo } = await setup({ test_old: { ok: false, reason: "paused" } });
    expect(jobs.quote("test_old", { prompt: "a fox" })).toEqual({ ok: false, error: "model_paused" });
    expect(await jobs.start(ACC, "test_old", { prompt: "a fox" })).toEqual({ ok: false, error: "model_paused" });
    expect(await repo.balance(ACC)).toBe(10);
  });

  it("gives a retry its running job back, even when the model was paused meanwhile", async () => {
    const { jobs, repo, states } = await setup();
    const first = await jobs.start(ACC, "test_old", { prompt: "a fox" }, { idempotencyKey: "k1" });
    expect(first).toMatchObject({ ok: true });
    states.test_old = { ok: false, reason: "paused" };
    const retry = await jobs.start(ACC, "test_old", { prompt: "a fox" }, { idempotencyKey: "k1" });
    expect(retry).toMatchObject({ ok: true, job: { id: (first as { job: { id: string } }).job.id } });
    expect(await repo.balance(ACC)).toBe(7);
  });

  it("names the successor of a retired model", async () => {
    const { jobs } = await setup({ test_old: { ok: false, reason: "retired", successor: "test_new" } });
    expect(jobs.quote("test_old", { prompt: "a fox" })).toEqual({ ok: false, error: "model_retired", successor: "test_new" });
    expect(await jobs.start(ACC, "test_old", { prompt: "a fox" })).toEqual({ ok: false, error: "model_retired", successor: "test_new" });
  });

  it("keeps a deprecated model usable until it retires", async () => {
    const { jobs } = await setup({ test_old: { ok: true, status: "deprecated", retiresAt: "2026-11-11", successor: "test_new" } });
    expect(jobs.quote("test_old", { prompt: "a fox" })).toMatchObject({ ok: true, credits: 3 });
    expect(await jobs.start(ACC, "test_old", { prompt: "a fox" })).toMatchObject({ ok: true, job: { status: "queued" } });
  });

  it("finishes a job whose model was retired after it started", async () => {
    const { jobs, fake, states } = await setup();
    const started = await jobs.start(ACC, "test_old", { prompt: "a fox" });
    if (!started.ok) throw new Error("job did not start");
    states.test_old = { ok: false, reason: "retired" };
    fake.next({ state: "completed", outputs: [{ contentType: "image/png", data: new Uint8Array([1]) }] });
    await jobs.tick();
    expect(await jobs.get(ACC, started.job.id)).toMatchObject({ status: "succeeded" });
  });
});
