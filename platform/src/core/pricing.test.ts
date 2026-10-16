import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKS, PLANS, creditsFromComfy } from "./pricing";

describe("cost model: credits from the router's price", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("passes the Comfy price on at markup 1, rounded up to a whole credit", () => {
    expect(creditsFromComfy(12.37)).toBe(13);
    expect(creditsFromComfy(30)).toBe(30);
    // Float dust is no reason to round up: 6.33 × 8 = 50.64 → 51, 10.55 × 4 = 42.2 → 43.
    expect(creditsFromComfy(6.33 * 8)).toBe(51);
    expect(creditsFromComfy(0.1 + 0.2 + 0.7)).toBe(1);
  });

  it("never prices a paid job at 0, and a free one at 0", () => {
    expect(creditsFromComfy(0.01)).toBe(1);
    expect(creditsFromComfy(0)).toBe(0);
  });

  it("applies CREDIT_MARKUP, and ignores a markup below 1 or one that is no number", () => {
    vi.stubEnv("CREDIT_MARKUP", "1.3");
    expect(creditsFromComfy(10)).toBe(13);
    expect(creditsFromComfy(12.37)).toBe(17); // 16.081 → 17
    vi.stubEnv("CREDIT_MARKUP", "0.5");
    expect(creditsFromComfy(10)).toBe(10);
    vi.stubEnv("CREDIT_MARKUP", "lots");
    expect(creditsFromComfy(10)).toBe(10);
  });
});

describe("cost model: credit packs and plans", () => {
  it("makes every bigger pack cheaper per credit", () => {
    const perCredit = CREDIT_PACKS.map((p) => p.priceChf / p.credits);
    for (let i = 1; i < perCredit.length; i++) expect(perCredit[i]).toBeLessThan(perCredit[i - 1]!);
  });

  it("makes every bigger plan cheaper per credit", () => {
    const perCredit = PLANS.map((p) => p.priceChf / p.credits);
    for (let i = 1; i < perCredit.length; i++) expect(perCredit[i]).toBeLessThan(perCredit[i - 1]!);
  });

  it("sells plan credits for no more than a pack of the same size, as the reward for a monthly commitment", () => {
    for (const plan of PLANS) {
      const pack = [...CREDIT_PACKS].reverse().find((p) => p.credits <= plan.credits) ?? CREDIT_PACKS[0]!;
      expect(plan.priceChf / plan.credits, plan.id).toBeLessThanOrEqual(pack.priceChf / pack.credits);
    }
  });
});
