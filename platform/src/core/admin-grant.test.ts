import { describe, expect, it } from "vitest";
import { adminGrant } from "./admin-grant";
import { createCredits } from "./credits";
import { createMemoryRepository } from "./repository";

const DAY = new Date("2026-10-13T18:00:00.000Z");
const ACC_X = "00000000-0000-4000-8000-0000000000cc";

describe("admin grant", () => {
  it("builds a ref from reason and day, so a repeat on the same day books nothing", async () => {
    const repo = createMemoryRepository();
    const ACC = "00000000-0000-4000-8000-0000000000aa";
    const g = adminGrant(ACC, 250, "Beispiele Welle 1", DAY);
    expect(g).toEqual({ ok: true, credits: 250, ref: `admin:${ACC}:beispiele-welle-1:2026-10-13` });
    if (!g.ok) throw new Error("not ok");
    await repo.grant(ACC, g.credits, g.ref);
    await repo.grant(ACC, g.credits, g.ref);
    expect(await repo.balance(ACC)).toBe(250);
    // The statement shows it as a manual adjustment, never as a purchase (no revenue in the numbers).
    const entry = (await createCredits(repo).statement(ACC)).entries.find((e) => e.kind === "grant");
    expect(entry).toMatchObject({ kind: "grant", source: "adjustment", credits: 250 });
  });

  it("gives a second account the same grant on the same day (the ref names the account)", async () => {
    const repo = createMemoryRepository();
    const A = "00000000-0000-4000-8000-0000000000aa";
    const B = "00000000-0000-4000-8000-0000000000bb";
    for (const acc of [A, B]) {
      const g = adminGrant(acc, 100, "Showcase", DAY);
      if (!g.ok) throw new Error("not ok");
      await repo.grant(acc, g.credits, g.ref);
    }
    expect([await repo.balance(A), await repo.balance(B)]).toEqual([100, 100]);
  });

  it("takes only whole credits from 1 to 5000 and a reason of a few words", () => {
    expect(adminGrant(ACC_X, 0, "test", DAY)).toEqual({ ok: false, error: "credits_out_of_range" });
    expect(adminGrant(ACC_X, 5001, "test", DAY)).toEqual({ ok: false, error: "credits_out_of_range" });
    expect(adminGrant(ACC_X, 12.5, "test", DAY)).toEqual({ ok: false, error: "credits_out_of_range" });
    expect(adminGrant(ACC_X, 10, "", DAY)).toEqual({ ok: false, error: "reason_missing" });
    expect(adminGrant(ACC_X, 10, "!!", DAY)).toEqual({ ok: false, error: "reason_missing" });
    // Never a purchase ref: a reason cannot turn the ref into stripe:… or welcome:….
    expect(adminGrant(ACC_X, 10, "stripe:evt_1", DAY)).toMatchObject({ ok: true, ref: `admin:${ACC_X}:stripe-evt-1:2026-10-13` });
  });
});
