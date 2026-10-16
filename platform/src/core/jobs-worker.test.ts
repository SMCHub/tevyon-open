import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createJobs, type WorkerOptions } from "./jobs";
import { createMemoryMediaStore, type MediaStore } from "./media";
import { createPrompting, type PromptWriter } from "./prompting";
import type { Provider, ProviderResult } from "./provider";
import { defineRegister, jobType } from "./register";
import type { JobRepository } from "./repository";
import { defineSkills } from "./skills";
import { repositories } from "./testing/repositories";

/** The worker: how fast and how safely jobs move from the queue through the vendor to a stored result. */

const register = defineRegister([
  jobType({
    jobType: "test_image", kind: "image", model: "Test Image 1", tagline: "Test vendor · for the worker tests",
    params: z.object({ prompt: z.string().min(1) }), credits: () => 2, route: { provider: "vendor", providerModel: "vendor/image-1" },
  }),
  jobType({
    jobType: "test_video", kind: "video", model: "Test Video 1", tagline: "Test vendor · for the worker tests",
    params: z.object({ prompt: z.string().min(1) }), credits: () => 5, route: { provider: "vendor", providerModel: "vendor/video-1" },
  }),
]);
const skills = defineSkills([{
  name: "prompt-test", version: "1.0.0", kind: "prompt", models: ["test_image", "test_video"], description: "Prompts for the test models.",
  body: "# Test", rules: { maxChars: 400, minWords: 1, negations: "ok", slots: ["subject"] },
}], register);

const ACC_1 = "00000000-0000-4000-8000-000000000001";
const ACC_2 = "00000000-0000-4000-8000-000000000002";
const PNG = new Uint8Array([137, 80, 78, 71]);
const done = (): ProviderResult => ({ state: "completed", outputs: [{ contentType: "image/png", data: PNG }] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits (real time) until the check holds; fails the test after `ms`. */
async function eventually(check: () => Promise<boolean>, ms = 2000) {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("condition not met in time");
    await sleep(5);
  }
}

/** A start call that never answers; only the worker's signal ends it. */
const hang = (signal?: AbortSignal) =>
  new Promise<ProviderResult>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));

/** A vendor whose calls take real time, counting how many run at once. */
function slowVendor(ms = 40) {
  const v = {
    active: 0,
    peak: 0,
    submits: 0,
    provider: {
      async submit() {
        v.submits++;
        v.active++;
        v.peak = Math.max(v.peak, v.active);
        await sleep(ms);
        v.active--;
        return done();
      },
      async poll() {
        return done();
      },
    } as Provider,
  };
  return v;
}

describe.each(repositories)("worker on %s repository", (_name, makeRepo) => {
  async function setup(
    vendor: Provider,
    opts: {
      credits?: number; worker?: WorkerOptions; media?: MediaStore; wrapRepo?: (repo: JobRepository) => JobRepository;
      onQueued?: (jobId: string) => void; writer?: PromptWriter;
    } = {},
  ) {
    const plain = await makeRepo();
    const repo = opts.wrapRepo ? opts.wrapRepo(plain) : plain;
    await repo.grant(ACC_1, opts.credits ?? 100, "grant_1");
    await repo.grant(ACC_2, opts.credits ?? 100, "grant_2");
    const media = opts.media ?? createMemoryMediaStore("https://media.tachyon.test");
    /** The worker's clock; tests move it forward instead of waiting. */
    const clock = { now: Date.now() };
    const jobs = createJobs({
      register, repo, providers: { vendor }, media, now: () => clock.now,
      prompting: createPrompting({ register, skills, ...(opts.writer ? { writer: opts.writer } : {}) }),
      ...(opts.worker ? { worker: opts.worker } : {}),
      ...(opts.onQueued ? { onQueued: opts.onQueued } : {}),
    });
    async function startJob(jobType = "test_image", accountId = ACC_1) {
      clock.now += 1; // jobs keep their order: oldest first
      const res = await jobs.start(accountId, jobType, { prompt: "a fox" });
      if (!res.ok) throw new Error(res.error);
      return res.job.id;
    }
    /** A second worker process on the same database. */
    const otherWorker = () => createJobs({
      register, repo, providers: { vendor }, media, now: () => clock.now, prompting: createPrompting({ register, skills }),
      ...(opts.worker ? { worker: opts.worker } : {}),
    });
    return { jobs, repo, media, clock, startJob, otherWorker };
  }

  it("works on several jobs at once: four images take about as long as one", async () => {
    const vendor = slowVendor();
    const { jobs, startJob } = await setup(vendor.provider);
    const ids = [await startJob(), await startJob(), await startJob(), await startJob()];

    await jobs.tick();

    expect(vendor.peak).toBe(4);
    for (const id of ids) expect((await jobs.get(ACC_1, id))?.status).toBe("succeeded");
  });

  it("takes turns between accounts, so a busy account cannot hold up someone else's job", async () => {
    const vendor = slowVendor();
    const { jobs, startJob } = await setup(vendor.provider, { worker: { submits: 2 } });
    const busy = [await startJob(), await startJob(), await startJob()];
    const other = await startJob("test_image", ACC_2);

    await jobs.tick();

    expect((await jobs.get(ACC_2, other))?.status).toBe("succeeded");
    expect((await jobs.get(ACC_1, busy[0]!))?.status).toBe("succeeded");
    expect((await jobs.get(ACC_1, busy[1]!))?.status).toBe("queued");
  });

  it("starts at most a few jobs per account at the same time", async () => {
    const vendor = slowVendor();
    const { jobs, startJob } = await setup(vendor.provider, { worker: { perAccount: 2 } });
    for (let i = 0; i < 5; i++) await startJob();

    await jobs.tick();

    expect(vendor.peak).toBe(2);
  });

  it("keeps other jobs moving while one hangs at the vendor, and never takes up the hanging one twice", async () => {
    let calls = 0;
    const vendor: Provider = {
      async submit(_req, signal) {
        calls++;
        return calls === 1 ? hang(signal) : done();
      },
      async poll() {
        return done();
      },
    };
    const { jobs, startJob } = await setup(vendor);
    const stuck = await startJob();
    await jobs.pump(); // returns at once: the first job now hangs at the vendor
    const quick = await startJob();
    await jobs.pump();
    await jobs.pump();

    await eventually(async () => (await jobs.get(ACC_1, quick))?.status === "succeeded");
    expect((await jobs.get(ACC_1, stuck))?.status).toBe("queued");
    expect(calls).toBe(2);
  });

  it("ends a start call that hangs past the worker's limit as timed out, refunds it and never sends it again", async () => {
    let calls = 0;
    const vendor: Provider = {
      async submit(_req, signal) {
        calls++;
        return hang(signal);
      },
      async poll() {
        return done();
      },
    };
    const { jobs, repo, clock, startJob } = await setup(vendor, { worker: { submitTimeoutMs: 30 } });
    const id = await startJob();

    await jobs.tick();
    clock.now += 600_000;
    await jobs.tick();

    expect(await jobs.get(ACC_1, id)).toMatchObject({ status: "failed", error: "timed_out" });
    expect(calls).toBe(1);
    expect(await repo.balance(ACC_1)).toBe(100);
  });

  it("gives up on a status check that hangs and asks again later", async () => {
    let polls = 0;
    const vendor: Provider = {
      async submit() {
        return { state: "pending", handle: "vendor-task-1" };
      },
      async poll(_handle, signal) {
        polls++;
        return polls === 1 ? hang(signal) : done();
      },
    };
    const { jobs, clock, startJob } = await setup(vendor, { worker: { pollTimeoutMs: 30 } });
    const id = await startJob("test_video");

    await jobs.tick(); // submitted, running
    await jobs.tick(); // the status check hangs and is cut off
    clock.now += 600_000;
    await jobs.tick();

    expect(await jobs.get(ACC_1, id)).toMatchObject({ status: "succeeded" });
  });

  it("waits longer after each failed call instead of asking again at once", async () => {
    let calls = 0;
    const vendor: Provider = {
      async submit() {
        calls++;
        throw new Error("vendor down");
      },
      async poll() {
        return done();
      },
    };
    const { jobs, clock, startJob } = await setup(vendor, { worker: { retryBaseMs: 1000 } });
    await startJob();

    await jobs.tick();
    await jobs.tick();
    expect(calls).toBe(1); // still pausing
    clock.now += 1_500; // past the first pause (1 s)
    await jobs.tick();
    expect(calls).toBe(2);
    clock.now += 1_500; // the second pause is longer (2 s)
    await jobs.tick();
    expect(calls).toBe(2);
    clock.now += 1_000;
    await jobs.tick();
    expect(calls).toBe(3);
  });

  it("keeps checking a running job through a long outage instead of giving up after a few tries", async () => {
    let polls = 0;
    const vendor: Provider = {
      async submit() {
        return { state: "pending", handle: "vendor-task-1" };
      },
      async poll() {
        if (++polls <= 8) throw new Error("vendor status page down");
        return done();
      },
    };
    const { jobs, repo, clock, startJob } = await setup(vendor);
    const id = await startJob("test_video");

    await jobs.tick();
    for (let i = 0; i < 9; i++) {
      clock.now += 75_000; // past the longest pause between tries (60 s + jitter)
      await jobs.tick();
    }

    expect(await jobs.get(ACC_1, id)).toMatchObject({ status: "succeeded" });
    expect(await repo.balance(ACC_1)).toBe(95);
  });

  it("stores a result the vendor already delivered once the store is back, without asking or paying again", async () => {
    let submits = 0;
    const vendor: Provider = {
      async submit() {
        submits++;
        return done();
      },
      async poll() {
        return done();
      },
    };
    const store = createMemoryMediaStore("https://media.tachyon.test");
    let storeDown = true;
    const media: MediaStore = {
      async put(key, data, contentType) {
        if (storeDown) throw new Error("media store unreachable");
        return store.put(key, data, contentType);
      },
    };
    const { jobs, clock, startJob } = await setup(vendor, { media });
    const id = await startJob();

    await jobs.tick();
    expect((await jobs.get(ACC_1, id))?.status).not.toBe("succeeded");
    storeDown = false;
    clock.now += 61_000;
    await jobs.tick();

    expect(await jobs.get(ACC_1, id)).toMatchObject({ status: "succeeded" });
    expect(submits).toBe(1);
  });

  it("ends a job that is still running past its deadline and gives the credits back", async () => {
    const vendor: Provider = {
      async submit() {
        return { state: "pending", handle: "vendor-task-1" };
      },
      async poll() {
        return { state: "pending", handle: "vendor-task-1" };
      },
    };
    const { jobs, repo, clock, startJob } = await setup(vendor, { worker: { videoDeadlineMs: 60 * 60_000 } });
    const id = await startJob("test_video");

    await jobs.tick();
    clock.now += 59 * 60_000;
    await jobs.tick();
    expect((await jobs.get(ACC_1, id))?.status).toBe("running");
    clock.now += 2 * 60_000;
    await jobs.tick();

    expect(await jobs.get(ACC_1, id)).toMatchObject({ status: "failed", error: "timed_out" });
    expect(await repo.balance(ACC_1)).toBe(100);
  });

  it("never sends a job twice when a pass read the job list just before the job finished", async () => {
    // A pass reads the active jobs, the read is slow, and meanwhile the job finishes: the old copy says "queued".
    let submits = 0;
    let releaseSubmit = () => {};
    const vendor: Provider = {
      async submit() {
        submits++;
        await new Promise<void>((r) => (releaseSubmit = r));
        return done();
      },
      async poll() {
        return done();
      },
    };
    let slowRead: { release: () => void; reading: Promise<void> } | undefined;
    const wrapRepo = (repo: JobRepository): JobRepository => ({
      ...repo,
      async active() {
        const snapshot = await repo.active();
        if (slowRead) await slowRead.reading;
        return snapshot;
      },
    });
    const { jobs, startJob } = await setup(vendor, { wrapRepo });
    const id = await startJob();

    await jobs.pump(); // the job is at the vendor
    let release = () => {};
    slowRead = { release: () => release(), reading: new Promise<void>((r) => (release = r)) };
    const stalePass = jobs.pump(); // reads "queued", then waits
    await sleep(10);
    slowRead = undefined;
    releaseSubmit(); // the job finishes while the stale pass still waits
    await eventually(async () => (await jobs.get(ACC_1, id))?.status === "succeeded");
    release();
    await stalePass;
    await sleep(20);

    expect(submits).toBe(1);
  });

  it("hands a new job to the worker right away instead of waiting for the next pass", async () => {
    const woken: string[] = [];
    const { jobs, startJob } = await setup(slowVendor().provider, { onQueued: (id) => woken.push(id) });

    const id = await startJob();
    await jobs.start(ACC_1, "test_image", { prompt: "" }); // refused: nothing to do
    await jobs.start(ACC_1, "test_image", { prompt: "a fox" }, { idempotencyKey: "k1" });
    await jobs.start(ACC_1, "test_image", { prompt: "a fox" }, { idempotencyKey: "k1" }); // the same job again

    expect(woken).toHaveLength(2);
    expect(woken[0]).toBe(id);
  });

  it("wakes a caller waiting for a job as soon as the job moves on", async () => {
    const { jobs, startJob } = await setup(slowVendor(10).provider);
    const id = await startJob();
    const started = Date.now();

    const waiting = jobs.waitFor(id, 10_000);
    await jobs.tick();
    await waiting;

    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("lets a waiting caller go after its wait when nothing happens", async () => {
    const { jobs, startJob } = await setup(slowVendor().provider);
    const id = await startJob();
    const started = Date.now();

    await jobs.waitFor(id, 60);

    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it("writes the prompt once when the same request starts several times at once (Anzahl 4)", async () => {
    let writes = 0;
    const writer: PromptWriter = {
      async write() {
        writes++;
        await sleep(20);
        return "A red fox in fresh snow, soft morning light";
      },
    };
    const sent: unknown[] = [];
    const vendor: Provider = {
      async submit(req) {
        sent.push(req.params.prompt);
        return done();
      },
      async poll() {
        return done();
      },
    };
    const { jobs, startJob } = await setup(vendor, { writer });

    await Promise.all([startJob(), startJob(), startJob(), startJob()]);
    await jobs.tick();

    expect(writes).toBe(1);
    expect(sent).toEqual(Array(4).fill("A red fox in fresh snow, soft morning light"));
  });

  it("writes a fresh prompt for the same request a while later (Variante)", async () => {
    let writes = 0;
    const writer: PromptWriter = {
      async write() {
        writes++;
        return `A red fox in fresh snow, take ${writes}`;
      },
    };
    const { jobs, clock, startJob } = await setup(slowVendor().provider, { writer });

    await startJob();
    await jobs.tick();
    clock.now += 5 * 60_000;
    await startJob();
    await jobs.tick();

    expect(writes).toBe(2);
  });

  it("never sends a job twice when two workers share the database", async () => {
    const vendor = slowVendor(30);
    const { jobs, startJob, otherWorker } = await setup(vendor.provider);
    const ids = [await startJob(), await startJob(), await startJob(), await startJob("test_image", ACC_2)];

    await Promise.all([jobs.tick(), otherWorker().tick()]);

    expect(vendor.submits).toBe(4);
    for (const id of ids.slice(0, 3)) expect((await jobs.get(ACC_1, id))?.status).toBe("succeeded");
  });

  it("takes over the jobs of a worker that stopped, once its claim runs out", async () => {
    let submits = 0;
    const vendor: Provider = {
      async submit(_req, signal) {
        return ++submits === 1 ? hang(signal) : done(); // the first worker stops answering
      },
      async poll() {
        return done();
      },
    };
    const { jobs, clock, startJob, otherWorker } = await setup(vendor, { worker: { leaseMs: 30_000 } });
    const id = await startJob();
    await jobs.pump();
    await eventually(async () => submits === 1);
    const second = otherWorker();

    await second.tick();
    expect(submits).toBe(1); // still claimed by the first worker
    clock.now += 31_000;
    await second.tick();

    expect(submits).toBe(2);
    expect((await second.get(ACC_1, id))?.status).toBe("succeeded");
  });

  it("keeps its claim while the vendor takes long, so no other worker sends the job again", async () => {
    let submits = 0;
    const vendor: Provider = {
      async submit(_req, signal) {
        submits++;
        return hang(signal);
      },
      async poll() {
        return done();
      },
    };
    const { jobs, clock, startJob, otherWorker } = await setup(vendor, { worker: { leaseMs: 30_000 } });
    await startJob();
    await jobs.pump();
    await eventually(async () => submits === 1);

    clock.now += 20_000;
    await jobs.pump(); // still working on it: the claim is renewed
    clock.now += 15_000;
    await otherWorker().tick();

    expect(submits).toBe(1);
  });

  it("keeps its claim during one long pass too (on Vercel each request runs tick()), so no other instance sends the job again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let submits = 0;
      const vendor: Provider = {
        async submit(_req, signal) {
          submits++;
          return hang(signal);
        },
        async poll() {
          return done();
        },
      };
      let claims = 0;
      const { jobs, clock, startJob, otherWorker } = await setup(vendor, {
        worker: { leaseMs: 30_000 },
        wrapRepo: (repo) => ({ ...repo, claim: async (...a) => { const r = await repo.claim(...a); claims++; return r; } }),
      });
      await startJob();
      void jobs.tick(); // an image may take minutes; this pass waits for it
      await eventually(async () => submits === 1);

      clock.now += 20_000;
      await vi.advanceTimersByTimeAsync(10_000);
      await eventually(async () => claims === 2); // taken, then renewed while the vendor still works
      clock.now += 15_000;
      await otherWorker().tick();

      expect(submits).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a job the vendor finished without any picture, and gives the credits back", async () => {
    const vendor: Provider = {
      async submit() {
        return { state: "completed", outputs: [] };
      },
      async poll() {
        return done();
      },
    };
    const { jobs, repo, startJob } = await setup(vendor);
    const id = await startJob();
    await jobs.tick();

    expect((await jobs.get(ACC_1, id))?.status).toBe("failed");
    expect(await repo.balance(ACC_1)).toBe(100);
  });

  it("answers a start at once and writes the prompt in the worker, before the job goes to the vendor", async () => {
    let writes = 0;
    const writer: PromptWriter = {
      async write() {
        writes++;
        return "A red fox in fresh snow, soft morning light";
      },
    };
    const sent: unknown[] = [];
    const vendor: Provider = {
      async submit(req) {
        sent.push(req.params.prompt);
        return done();
      },
      async poll() {
        return done();
      },
    };
    const { jobs, startJob } = await setup(vendor, { writer });

    const id = await startJob();
    expect(writes).toBe(0); // the start did not wait for the writer
    expect((await jobs.get(ACC_1, id))?.promptSkill).toBe("prompt-test@1.0.0");
    await jobs.tick();

    expect(writes).toBe(1);
    expect(sent).toEqual(["A red fox in fresh snow, soft morning light"]);
    expect((await jobs.get(ACC_1, id))?.params.prompt).toBe("a fox"); // the user's own words stay in the job
  });
});
