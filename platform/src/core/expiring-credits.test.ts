import { describe, expect, it } from "vitest";
import { repositories } from "./testing/repositories";

/**
 * Plan credits (Abo) expire with their period, bought and welcome credits never do.
 * Plan credits are spent first. A job keeps what it reserved before the period ended; if it fails afterwards, its credits
 * come back as normal credits, because «Credits zurück bei Fehlschlag» has to hold at the boundary too.
 */
const ACC = "00000000-0000-4000-8000-0000000000e1";
const JOB_1 = "10000000-0000-4000-8000-0000000000e1";
const JOB_2 = "10000000-0000-4000-8000-0000000000e2";
const T = Date.parse("2026-11-15T00:00:00Z");

describe.each(repositories)("%s repository: plan credits that expire", (_name, makeRepo) => {
  async function setup(start = T - 60_000) {
    const clock = { now: start };
    const repo = await makeRepo({ now: () => clock.now });
    const job = (id: string, credits: number) => ({
      id, accountId: ACC, jobType: "t", model: "T", credits, params: { prompt: "x" }, createdAt: clock.now,
    });
    return { repo, clock, job };
  }

  it("lets the plan credits that are left lapse at the end of their period, bought credits stay", async () => {
    const { repo, clock, job } = await setup();
    await repo.grant(ACC, 100, "stripe:cs_1");
    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });
    expect(await repo.balance(ACC)).toBe(600);

    clock.now = T;

    expect(await repo.balance(ACC)).toBe(100);
    expect(await repo.create(job(JOB_1, 101))).toEqual({ ok: false, error: "insufficient_credits" });
    expect((await repo.create(job(JOB_1, 100))).ok).toBe(true);
  });

  it("spends plan credits first, so the bought credits are what is left when the period ends", async () => {
    const { repo, clock, job } = await setup();
    await repo.grant(ACC, 100, "stripe:cs_1");
    await repo.grant(ACC, 50, "sub:in_1", undefined, { expiresAt: T });

    await repo.create(job(JOB_1, 80));
    expect(await repo.balance(ACC)).toBe(70);

    clock.now = T;
    expect(await repo.balance(ACC)).toBe(70);
  });

  it("keeps what a job reserved before the period ended, also when it finishes after", async () => {
    const { repo, clock, job } = await setup();
    await repo.grant(ACC, 100, "stripe:cs_1");
    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });
    await repo.create(job(JOB_1, 550));
    expect(await repo.balance(ACC)).toBe(50);

    clock.now = T + 5_000;
    await repo.succeed(JOB_1, [{ url: "/m/1", contentType: "video/mp4" }]);

    expect(await repo.balance(ACC)).toBe(50);
  });

  it("gives a job's credits back as normal credits when it fails after its period ended", async () => {
    const { repo, clock, job } = await setup();
    await repo.grant(ACC, 100, "stripe:cs_1");
    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });
    await repo.create(job(JOB_1, 300));

    clock.now = T + 5_000;
    expect(await repo.balance(ACC)).toBe(100);
    await repo.fail(JOB_1, "generation_failed");
    expect(await repo.balance(ACC)).toBe(400);

    clock.now = T + 365 * 86_400_000;
    expect(await repo.balance(ACC)).toBe(400);
  });

  it("gives a failed job's credits back to its plan while the period runs", async () => {
    const { repo, clock, job } = await setup();
    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });
    await repo.create(job(JOB_1, 300));
    await repo.fail(JOB_1, "generation_failed");
    expect(await repo.balance(ACC)).toBe(500);

    clock.now = T;
    expect(await repo.balance(ACC)).toBe(0);
  });

  it("starts the next period's credits while the old ones lapse", async () => {
    const { repo, clock, job } = await setup();
    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });
    await repo.create(job(JOB_1, 200));

    clock.now = T;
    await repo.grant(ACC, 500, "sub:in_2", undefined, { expiresAt: T + 30 * 86_400_000 });

    expect(await repo.balance(ACC)).toBe(500);
    await repo.create(job(JOB_2, 120));
    expect(await repo.balance(ACC)).toBe(380);
  });

  it("holds a Director message from plan credits first and gives what it did not cost back to the plan", async () => {
    const { repo, clock } = await setup();
    await repo.grant(ACC, 100, "stripe:cs_1");
    await repo.grant(ACC, 50, "sub:in_1", undefined, { expiresAt: T });

    await repo.debit({ accountId: ACC, credits: 40, ref: "director:t1", kind: "director", hold: true });
    await repo.settleDebit("director:t1", 16);
    expect(await repo.balance(ACC)).toBe(134);

    clock.now = T;
    expect(await repo.balance(ACC)).toBe(100);
  });

  it("keeps a Director message's cost on the earliest plan credits and gives the rest back to the latest, also at the same expiry", async () => {
    const { repo, clock } = await setup();
    await repo.grant(ACC, 30, "sub:in_1", undefined, { expiresAt: T });
    clock.now += 1;
    // An upgrade in the middle of the month: its credits end with the same month.
    await repo.grant(ACC, 100, "sub:in_up", undefined, { expiresAt: T });

    await repo.debit({ accountId: ACC, credits: 40, ref: "director:t1", kind: "director", hold: true });
    await repo.settleDebit("director:t1", 16);

    expect((await repo.grants(ACC)).map((g) => [g.ref, g.remaining])).toEqual([["sub:in_1", 14], ["sub:in_up", 100]]);
    expect(await repo.balance(ACC)).toBe(114);
  });

  it("takes a refunded pack from the bought credits first, not from the plan", async () => {
    const { repo, clock } = await setup();
    await repo.grant(ACC, 1000, "stripe:cs_1", { intent: "pi_1", amount: 1000 });
    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });

    expect(await repo.debit({ accountId: ACC, credits: 1000, ref: "refund:pi_1:1000", kind: "refund" })).toEqual({ ok: true, collected: 1000, owed: 0 });
    expect(await repo.balance(ACC)).toBe(500);

    clock.now = T;
    expect(await repo.balance(ACC)).toBe(0);
  });

  it("pays an open debt from a new plan grant first, so none of it is left to lapse", async () => {
    const { repo, clock, job } = await setup();
    await repo.grant(ACC, 1000, "stripe:cs_1", { intent: "pi_1", amount: 1000 });
    await repo.create(job(JOB_1, 900));
    await repo.debit({ accountId: ACC, credits: 1000, ref: "refund:pi_1:1000", kind: "refund" });
    expect(await repo.owed(ACC)).toBe(900);

    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });
    expect(await repo.owed(ACC)).toBe(400);
    expect(await repo.balance(ACC)).toBe(0);

    clock.now = T;
    expect(await repo.balance(ACC)).toBe(0);
  });

  it("never changes what lapsed: a refund after the end takes bought credits, the ended plan keeps its remainder", async () => {
    const { repo, clock } = await setup();
    await repo.grant(ACC, 100, "stripe:cs_1", { intent: "pi_1", amount: 100 });
    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });

    clock.now = T + 1;
    expect(await repo.debit({ accountId: ACC, credits: 100, ref: "refund:pi_1:100", kind: "refund" })).toEqual({ ok: true, collected: 100, owed: 0 });

    expect(await repo.balance(ACC)).toBe(0);
    expect((await repo.grants(ACC)).find((g) => g.ref === "sub:in_1")).toMatchObject({ remaining: 500 });
  });

  it("takes a refunded plan invoice from that plan's own credits first", async () => {
    const { repo, clock } = await setup();
    await repo.grant(ACC, 100, "stripe:cs_1");
    await repo.grant(ACC, 500, "sub:in_1", { intent: "pi_sub", amount: 1800 }, { expiresAt: T });

    await repo.debit({ accountId: ACC, credits: 500, ref: "refund:pi_sub:1800", kind: "refund", preferGrant: "sub:in_1" });

    expect(await repo.balance(ACC)).toBe(100);
    clock.now = T;
    expect(await repo.balance(ACC)).toBe(100);
  });

  it("lists each grant with its expiry and what is left of it", async () => {
    const { repo } = await setup();
    await repo.grant(ACC, 100, "stripe:cs_1");
    await repo.grant(ACC, 500, "sub:in_1", undefined, { expiresAt: T });
    await repo.debit({ accountId: ACC, credits: 30, ref: "director:t1", kind: "director", hold: true });

    expect(await repo.grants(ACC)).toMatchObject([
      { ref: "stripe:cs_1", credits: 100 },
      { ref: "sub:in_1", credits: 500, expiresAt: T, remaining: 470 },
    ]);
    expect((await repo.grants(ACC))[0]).not.toHaveProperty("expiresAt");
  });
});
