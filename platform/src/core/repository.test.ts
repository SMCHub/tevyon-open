import { describe, expect, it } from "vitest";
import { repositories } from "./testing/repositories";

const ACC = "00000000-0000-4000-8000-0000000000aa";
const job = (id: string, credits: number) => ({
  id, accountId: ACC, jobType: "t", model: "T", credits, params: { prompt: "x" }, createdAt: Date.now(),
});
const ID_1 = "10000000-0000-4000-8000-000000000001";

describe.each(repositories)("%s repository: credit bookings", (_name, makeRepo) => {
  it("books a grant only once per reference", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 50, "stripe_evt_1");
    await repo.grant(ACC, 50, "stripe_evt_1");
    expect(await repo.balance(ACC)).toBe(50);
  });

  it("refunds a failed job exactly once, even if the failure is reported twice", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 10, "g");
    await repo.create(job(ID_1, 4));
    await repo.fail(ID_1, "generation_failed");
    await repo.fail(ID_1, "generation_failed");
    expect(await repo.balance(ACC)).toBe(10);
  });

  it("never refunds a job that already succeeded", async () => {
    const repo = await makeRepo();
    await repo.grant(ACC, 10, "g");
    await repo.create(job(ID_1, 4));
    await repo.succeed(ID_1, [{ url: "/m/1", contentType: "image/png" }]);
    await repo.fail(ID_1, "generation_failed");
    expect(await repo.balance(ACC)).toBe(6);
    expect((await repo.get(ID_1))?.status).toBe("succeeded");
  });

  it("starts nothing for an account without credits", async () => {
    const repo = await makeRepo();
    expect(await repo.create(job(ID_1, 1))).toEqual({ ok: false, error: "insufficient_credits" });
    expect(await repo.get(ID_1)).toBeUndefined();
  });
});
