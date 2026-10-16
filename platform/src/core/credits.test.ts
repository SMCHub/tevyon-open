import { describe, expect, it } from "vitest";
import { createCredits, hasPaid } from "./credits";
import { repositories } from "./testing/repositories";

const ACC = "00000000-0000-4000-8000-0000000000c1";
const JOB_1 = "10000000-0000-4000-8000-0000000000c1";
const JOB_A = "10000000-0000-4000-8000-0000000000a1";
const JOB_B = "10000000-0000-4000-8000-0000000000b1";
const JOB_C = "10000000-0000-4000-8000-0000000000d1";
const T0 = Date.now() + 60_000;

const video = (id: string, credits: number, createdAt = T0) => ({
  id, accountId: ACC, jobType: "veo_3_1_lite", model: "Veo 3.1 Lite", credits, params: { prompt: "a lighthouse in a storm" }, createdAt,
});

describe.each(repositories)("%s repository: credit statement", (_name, makeRepo) => {
  async function welcomed() {
    const repo = await makeRepo();
    await repo.grant(ACC, 100, `welcome:${ACC}`);
    return { repo, credits: createCredits(repo) };
  }

  it("shows a new account's welcome grant and its balance", async () => {
    const { credits } = await welcomed();

    const s = await credits.statement(ACC);

    expect(s.summary).toEqual({ available: 100, reserved: 0, spent: 0, refunded: 0, granted: 100, debited: 0, owed: 0, expired: 0 });
    expect(s.entries).toMatchObject([{ kind: "grant", source: "welcome", credits: 100, balance: 100 }]);
  });

  it("holds a running job's credits as reserved", async () => {
    const { repo, credits } = await welcomed();
    await repo.create(video(JOB_1, 64));

    const s = await credits.statement(ACC);

    expect(s.summary).toEqual({ available: 36, reserved: 64, spent: 0, refunded: 0, granted: 100, debited: 0, owed: 0, expired: 0 });
    expect(s.entries[0]).toMatchObject({ kind: "job", jobId: JOB_1, model: "Veo 3.1 Lite", state: "reserved", amount: 64, credits: -64, balance: 36 });
  });

  it("charges a job that succeeded", async () => {
    const { repo, credits } = await welcomed();
    await repo.create(video(JOB_1, 64));
    await repo.succeed(JOB_1, [{ url: "/m/1", contentType: "video/mp4" }]);

    const s = await credits.statement(ACC);

    expect(s.summary).toEqual({ available: 36, reserved: 0, spent: 64, refunded: 0, granted: 100, debited: 0, owed: 0, expired: 0 });
    expect(s.entries[0]).toMatchObject({ kind: "job", state: "charged", amount: 64, credits: -64, balance: 36 });
  });

  it("shows a failed job as refunded, leaving the balance untouched", async () => {
    const { repo, credits } = await welcomed();
    await repo.create(video(JOB_1, 64));
    await repo.fail(JOB_1, "content_moderated");

    const s = await credits.statement(ACC);

    expect(s.summary).toEqual({ available: 100, reserved: 0, spent: 0, refunded: 64, granted: 100, debited: 0, owed: 0, expired: 0 });
    expect(s.entries[0]).toMatchObject({ kind: "job", state: "refunded", amount: 64, credits: 0, balance: 100 });
  });

  it("lists every movement newest first with the balance after each one, ending at the bookable balance", async () => {
    const { repo, credits } = await welcomed();
    await repo.create(video(JOB_A, 7, T0 + 1000));
    await repo.succeed(JOB_A, [{ url: "/m/a", contentType: "image/png" }]);
    await repo.create(video(JOB_B, 64, T0 + 2000));
    await repo.fail(JOB_B, "generation_failed");
    await repo.create(video(JOB_C, 32, T0 + 3000));

    const s = await credits.statement(ACC);

    expect(s.entries.map((e) => [e.kind, e.credits, e.balance])).toEqual([
      ["job", -32, 61],
      ["job", 0, 93],
      ["job", -7, 93],
      ["grant", 100, 100],
    ]);
    expect(s.summary).toEqual({ available: 61, reserved: 32, spent: 7, refunded: 64, granted: 100, debited: 0, owed: 0, expired: 0 });
    expect(await repo.balance(ACC)).toBe(61);
  });

  it("names where granted credits came from, without revealing the internal reference", async () => {
    const { repo, credits } = await welcomed();
    await repo.grant(ACC, 500, "stripe_evt_9f8e7d");
    await repo.grant(ACC, 85, "ops-note-refund-for-ticket-4711");

    const s = await credits.statement(ACC);

    expect(s.entries.map((e) => (e.kind === "grant" ? e.source : e.kind)).sort()).toEqual(["adjustment", "purchase", "welcome"]);
    const text = JSON.stringify(s);
    for (const secret of ["stripe_evt_9f8e7d", "ops-note", "4711", `welcome:${ACC}`]) expect(text).not.toContain(secret);
  });

  it("names the channel each job came from", async () => {
    const { repo, credits } = await welcomed();
    await repo.create({ ...video(JOB_A, 7, T0 + 1000), origin: "mcp", apiKeyId: "20000000-0000-4000-8000-000000000001" });
    await repo.create(video(JOB_B, 7, T0 + 2000));

    const s = await credits.statement(ACC);

    expect(s.entries.filter((e) => e.kind === "job").map((e) => e.kind === "job" && e.origin)).toEqual(["web", "mcp"]);
  });

  it("lets only one of two simultaneous starts reserve credits that cover just one", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 10, "g");

    const results = await Promise.all([repo.create(video(JOB_A, 6)), repo.create(video(JOB_B, 6))]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await repo.balance(ACC)).toBe(4);
  });

  it("never shows provider details of a job", async () => {
    const { repo, credits } = await welcomed();
    await repo.create({ ...video(JOB_1, 64), providerParams: { prompt: "skill wording 7f3a" }, promptSkill: "prompt-veo@1.0.0" });
    await repo.markRunning(JOB_1, "vendor-task-1");
    await repo.fail(JOB_1, "generation_failed", "upstream https://vendor.example/x said no");

    const text = JSON.stringify(await credits.statement(ACC));

    for (const secret of ["vendor-task-1", "vendor.example", "said no", "skill wording 7f3a", "prompt-veo"]) expect(text).not.toContain(secret);
  });

  it("shows a Director message as reserved while it runs, then charged at what it cost", async () => {
    const { repo, credits } = await welcomed();
    await repo.debit({ accountId: ACC, credits: 35, ref: "director:t1", kind: "director", model: "Claude Fable 5.1", hold: true });

    const running = await credits.statement(ACC);
    expect(running.entries[0]).toMatchObject({ kind: "director", model: "Claude Fable 5.1", state: "reserved", amount: 35, credits: -35, balance: 65 });
    expect(running.summary).toMatchObject({ available: 65, reserved: 35 });

    await repo.settleDebit("director:t1", 16);
    const done = await credits.statement(ACC);
    expect(done.entries[0]).toMatchObject({ kind: "director", state: "charged", amount: 16, credits: -16, balance: 84 });
    expect(done.summary).toMatchObject({ available: 84, reserved: 0, spent: 16 });
    expect(await repo.balance(ACC)).toBe(84);
    expect(JSON.stringify(done)).not.toContain("director:t1");
  });

  it("shows a refunded purchase, what is still owed and a balance below zero until it is paid", async () => {
    const repo = await makeRepo();
    const credits = createCredits(repo);
    await repo.grant(ACC, 1000, "stripe:cs_1");
    await repo.create({ ...video(JOB_1, 900), createdAt: Date.now() });
    await repo.succeed(JOB_1, [{ url: "/m/1", contentType: "video/mp4" }]);
    await repo.debit({ accountId: ACC, credits: 1000, ref: "refund:pi_1:1000", kind: "refund" });

    const s = await credits.statement(ACC);

    expect(s.entries.map((e) => [e.kind, e.credits, e.balance])).toEqual([["reversal", -1000, -900], ["job", -900, 100], ["grant", 1000, 1000]]);
    expect(s.entries[0]).toMatchObject({ source: "refund" });
    expect(s.summary).toMatchObject({ available: 0, owed: 900, debited: 1000, spent: 900, granted: 1000 });
    expect(await repo.balance(ACC)).toBe(0);
  });

  it("books a won dispute back", async () => {
    const { repo, credits } = await welcomed();
    await repo.debit({ accountId: ACC, credits: 100, ref: "dispute:dp_1", kind: "dispute" });
    await repo.voidDebit("dispute:dp_1");

    const s = await credits.statement(ACC);

    expect(s.entries.map((e) => [e.kind, e.kind === "reversal" ? e.source : "", e.credits, e.balance])).toEqual([
      ["reversal", "dispute_won", 100, 100],
      ["reversal", "dispute", -100, 0],
      ["grant", "", 100, 100],
    ]);
    expect(s.summary).toMatchObject({ available: 100, owed: 0, debited: 0 });
  });
});

describe.each(repositories)("%s repository: credit statement with plan credits", (_name, makeRepo) => {
  const T = Date.parse("2026-11-15T00:00:00Z");

  async function planned() {
    const clock = { now: T - 60_000 };
    const repo = await makeRepo({ now: () => clock.now });
    const credits = createCredits(repo, { now: () => clock.now });
    await repo.grant(ACC, 100, "stripe:cs_1");
    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });
    return { repo, credits, clock };
  }

  it("shows the monthly plan credits as a plan grant and when the ones left run out", async () => {
    const { credits } = await planned();

    const s = await credits.statement(ACC);

    expect(s.entries[0]).toMatchObject({ kind: "grant", source: "subscription", credits: 500 });
    expect(s.expiring).toEqual({ credits: 500, at: T });
    expect(s.summary).toMatchObject({ available: 600, expired: 0 });
  });

  it("books what was left at the end of the period as lapsed, and agrees with the balance", async () => {
    const { repo, credits, clock } = await planned();
    await repo.create({ ...video(JOB_1, 200), createdAt: clock.now });
    await repo.succeed(JOB_1, [{ url: "/m/1", contentType: "video/mp4" }]);

    clock.now = T + 1;
    const s = await credits.statement(ACC);

    expect(s.entries[0]).toMatchObject({ kind: "expiry", at: T, credits: -300, balance: 100 });
    expect(s.summary).toMatchObject({ available: 100, expired: 300, spent: 200, granted: 600 });
    expect(s.expiring).toBeNull();
    expect(s.summary.available).toBe(await repo.balance(ACC));
  });

  it("agrees with the balance when a job reserved before the end fails after it", async () => {
    const { repo, credits, clock } = await planned();
    await repo.create({ ...video(JOB_1, 300), createdAt: clock.now });

    clock.now = T + 5_000;
    await repo.fail(JOB_1, "generation_failed");
    const s = await credits.statement(ACC);

    expect(s.summary).toMatchObject({ available: 400, expired: 200, refunded: 300 });
    expect(s.summary.available).toBe(await repo.balance(ACC));
  });

  it("agrees with the balance when a job reserved before the end succeeds after it", async () => {
    const { repo, credits, clock } = await planned();
    await repo.create({ ...video(JOB_1, 550), createdAt: clock.now });

    clock.now = T + 5_000;
    await repo.succeed(JOB_1, [{ url: "/m/1", contentType: "video/mp4" }]);
    const s = await credits.statement(ACC);

    expect(s.summary).toMatchObject({ available: 50, expired: 0, spent: 550 });
    expect(s.summary.available).toBe(await repo.balance(ACC));
  });
});


describe("paying account", () => {
  const grant = (ref: string, credits: number) => ({ ref, credits });
  const debit = (kind: "refund" | "dispute" | "director", credits: number, state: "settled" | "void" = "settled") => ({ kind, credits, state });

  it("counts a pack or a plan, but not a purchase that went back in full", () => {
    expect(hasPaid([grant("welcome:a", 100)], [])).toBe(false);
    expect(hasPaid([grant("stripe:cs_1", 1_000)], [])).toBe(true);
    expect(hasPaid([grant("stripe:cs_1", 1_000)], [debit("refund", 1_000)])).toBe(false);
    expect(hasPaid([grant("stripe:cs_1", 1_000)], [debit("dispute", 1_000)])).toBe(false);
    // A won dispute (void) or a partial refund leaves the purchase standing; spending is no refund.
    expect(hasPaid([grant("stripe:cs_1", 1_000)], [debit("dispute", 1_000, "void")])).toBe(true);
    expect(hasPaid([grant("sub:in_1", 2_000)], [debit("refund", 500), debit("director", 1_900)])).toBe(true);
  });
});
