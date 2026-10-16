import { describe, expect, it } from "vitest";
import { repositories } from "./testing/repositories";

const ACC = "00000000-0000-4000-8000-0000000000aa";
const JOB = "10000000-0000-4000-8000-000000000001";
const job = (credits: number) => ({ id: JOB, accountId: ACC, jobType: "t", model: "T", credits, params: { prompt: "x" }, createdAt: Date.now() });

describe.each(repositories)("%s repository: credits that leave outside of a job", (_name, makeRepo) => {
  it("holds a Director message at its cap while it runs, then keeps only what it cost", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 100, "g");

    expect(await repo.debit({ accountId: ACC, credits: 40, ref: "director:t1", kind: "director", model: "Claude Fable 5.1", hold: true }))
      .toEqual({ ok: true, collected: 40, owed: 0 });
    expect(await repo.balance(ACC)).toBe(60);

    await repo.settleDebit("director:t1", 16);
    await repo.settleDebit("director:t1", 30);
    expect(await repo.balance(ACC)).toBe(84);
    expect(await repo.debits(ACC)).toMatchObject([{ kind: "director", state: "settled", credits: 16, collected: 16, model: "Claude Fable 5.1" }]);
  });

  it("gives back a hold whose message never ended (process killed mid-stream), but leaves running and settled ones", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 100, "g");
    await repo.debit({ accountId: ACC, credits: 40, ref: "director:lost", kind: "director", hold: true });
    await repo.debit({ accountId: ACC, credits: 10, ref: "director:done", kind: "director", hold: true });
    await repo.settleDebit("director:done", 5);
    expect(await repo.balance(ACC)).toBe(55);

    // Taken before this moment: still running a minute ago is no reason to touch it.
    expect(await repo.voidStaleHolds(Date.now() - 60_000)).toBe(0);
    expect(await repo.voidStaleHolds(Date.now() + 1_000)).toBe(1);
    expect(await repo.balance(ACC)).toBe(95);
    expect(await repo.debits(ACC)).toMatchObject([{ ref: "director:lost", state: "void" }, { ref: "director:done", state: "settled", credits: 5 }]);
    expect(await repo.voidStaleHolds(Date.now() + 1_000, ACC)).toBe(0);
  });

  it("refuses a message the account cannot cover at its cap, and books nothing", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 30, "g");

    expect(await repo.debit({ accountId: ACC, credits: 40, ref: "director:t1", kind: "director", hold: true })).toEqual({ ok: false, error: "insufficient_credits" });
    expect(await repo.balance(ACC)).toBe(30);
    expect(await repo.debits(ACC)).toEqual([]);
  });

  it("gives a held message back in full when the turn never began", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 50, "g");
    await repo.debit({ accountId: ACC, credits: 40, ref: "director:t1", kind: "director", hold: true });

    await repo.voidDebit("director:t1");
    await repo.voidDebit("director:t1");

    expect(await repo.balance(ACC)).toBe(50);
    expect(await repo.debits(ACC)).toMatchObject([{ state: "void" }]);
  });

  it("takes a refunded purchase from what is left, and the next grants pay the rest first", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 1000, "stripe:cs_1");
    await repo.create(job(900));

    expect(await repo.debit({ accountId: ACC, credits: 1000, ref: "refund:pi_1:1000", kind: "refund" })).toEqual({ ok: true, collected: 100, owed: 900 });
    expect(await repo.debit({ accountId: ACC, credits: 1000, ref: "refund:pi_1:1000", kind: "refund" })).toEqual({ ok: true, collected: 100, owed: 900 });
    expect([await repo.balance(ACC), await repo.owed(ACC)]).toEqual([0, 900]);

    await repo.grant(ACC, 500, "stripe:cs_2");
    expect([await repo.balance(ACC), await repo.owed(ACC)]).toEqual([0, 400]);
    await repo.grant(ACC, 600, "stripe:cs_3");
    expect([await repo.balance(ACC), await repo.owed(ACC)]).toEqual([200, 0]);
  });

  it("gives back what a won dispute took and cancels what is still owed", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 100, "g");
    await repo.debit({ accountId: ACC, credits: 300, ref: "dispute:dp_1", kind: "dispute" });
    expect([await repo.balance(ACC), await repo.owed(ACC)]).toEqual([0, 200]);

    await repo.voidDebit("dispute:dp_1");

    expect([await repo.balance(ACC), await repo.owed(ACC)]).toEqual([100, 0]);
  });

  it("finds the purchase behind a payment, so a refund or dispute knows its credits", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 3000, "stripe:cs_1", { intent: "pi_1", amount: 2700 });

    expect(await repo.purchaseByPayment("pi_1")).toEqual({ accountId: ACC, credits: 3000, amount: 2700, ref: "stripe:cs_1" });
    expect(await repo.purchaseByPayment("pi_unknown")).toBeUndefined();
  });

  it("keeps what a failed job cost at the provider, for the real cost", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 10, "g");
    await repo.create(job(4));

    await repo.fail(JOB, "generation_failed", "boom", 0.02);

    expect(await repo.get(JOB)).toMatchObject({ status: "failed", costUsd: 0.02 });
    expect(await repo.balance(ACC)).toBe(10);
  });

  it("counts a Director message paid through an API key against that key's daily limit, like a job", async () => {
    const repo = await makeRepo();
    const KEY = "20000000-0000-4000-8000-000000000001";
    const since = Date.now() - 86_400_000;
    await repo.grant(ACC, 200, "g");

    const first = await repo.debit({ accountId: ACC, credits: 35, ref: "director:k1", kind: "director", hold: true, apiKeyId: KEY, keyLimit: { credits: 60, since } });
    expect(first).toEqual({ ok: true, collected: 35, owed: 0 });
    expect(await repo.debit({ accountId: ACC, credits: 35, ref: "director:k2", kind: "director", hold: true, apiKeyId: KEY, keyLimit: { credits: 60, since } }))
      .toEqual({ ok: false, error: "key_limit_reached", limit: 60, used: 35 });

    await repo.settleDebit("director:k1", 16);
    expect(await repo.spentByKey(KEY, since)).toBe(16);
    await repo.create({ ...job(20), apiKeyId: KEY });
    expect(await repo.spentByKey(KEY, since)).toBe(36);
    expect(await repo.create({ ...job(30), id: "10000000-0000-4000-8000-000000000002", apiKeyId: KEY }, undefined, { keyLimit: { credits: 60, since } }))
      .toMatchObject({ ok: false, error: "key_limit_reached", used: 36 });

    await repo.debit({ accountId: ACC, credits: 10, ref: "director:k3", kind: "director", hold: true, apiKeyId: KEY });
    await repo.voidDebit("director:k3");
    expect(await repo.spentByKey(KEY, since)).toBe(36);
  });
});

