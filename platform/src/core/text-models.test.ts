import { describe, expect, it } from "vitest";
import { MAX_TURN, TEXT_MODELS, USD_PER_COMFY_CREDIT, defaultTextModel, isPaid, messageCredits, publicTextModels, settleCredits, textModel, turnCostUsd } from "./text-models";

describe("text models for the Director", () => {
  it("offers the strongest models in three tiers, with Claude Sonnet 5.5 as the one default", () => {
    expect(new Set(TEXT_MODELS.map((m) => m.tier))).toEqual(new Set(["beste", "ausgewogen", "schnell"]));
    expect(TEXT_MODELS.filter((m) => m.default)).toHaveLength(1);
    expect(defaultTextModel()).toMatchObject({ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", tier: "ausgewogen" });
    expect(TEXT_MODELS.find((m) => m.tier === "beste" && m.name === "Claude Fable 5.1")).toBeTruthy();
  });

  it("routes every model through the router's chat route with a dated list price", () => {
    for (const m of TEXT_MODELS) {
      expect(m.route).toMatchObject({ provider: "comfy" });
      expect(m.route.slug, m.id).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
      expect(m.price.inputPerM).toBeGreaterThan(0);
      expect(m.price.approved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("finds a model by its own id and knows no others", () => {
    expect(textModel("claude-fable-5-1")?.name).toBe("Claude Fable 5.1");
    expect(textModel("anthropic/claude-fable-5.1")).toBeUndefined();
    expect(textModel("gpt-9")).toBeUndefined();
  });

  it("estimates what a turn costs from its tokens", () => {
    // Sonnet 5.5: 4,000 × $2/M + 600 × $10/M = $0.008 + $0.006 = $0.014
    expect(turnCostUsd(textModel("claude-sonnet-5-5")!, { input: 4_000, output: 600 })).toBeCloseTo(0.014, 9);
  });

  it("lists models publicly with a coarse cost class, but never the vendor id, the route or a price", () => {
    const list = publicTextModels();
    expect(list.find((m) => m.id === "claude-fable-5-1")).toMatchObject({ cost: 4, vision: true });
    expect(list.find((m) => m.id === "claude-sonnet-5-5")).toMatchObject({ cost: 2, default: true });
    expect(list.find((m) => m.id === "claude-haiku-5-5")).toMatchObject({ cost: 1 });
    const text = JSON.stringify(list);
    expect(text).not.toMatch(/comfy|anthropic\/|openai\/|google\/|x-ai\/|"route"|"price"|inputPerM/i);
  });

  it("charges credits per message only for the strongest models, from the USD cost at USD_PER_COMFY_CREDIT", () => {
    expect(USD_PER_COMFY_CREDIT).toBeCloseTo(1 / 211, 12);
    expect(TEXT_MODELS.filter(isPaid).map((m) => m.id)).toEqual(["claude-fable-5-1", "claude-opus-5-5", "gpt-6-astra"]);
    // Fable 5.1: typical turn $0.07 × 211 = 14.77 → 15; longest turn 8,000 × $10/M + 1,500 × $50/M = $0.155 × 211 = 32.7 → 33
    expect(messageCredits(textModel("claude-fable-5-1")!)).toEqual({ typical: 15, cap: 33 });
    expect(messageCredits(textModel("claude-opus-5-5")!)).toEqual({ typical: 6, cap: 14 });
    expect(settleCredits(textModel("claude-fable-5-1")!, 0.0712)).toBe(16);
    expect(settleCredits(textModel("claude-fable-5-1")!, 0.5)).toBe(33);
    expect(settleCredits(textModel("claude-fable-5-1")!, 0.0001)).toBe(1);
  });

  it("never charges a paid message less than its cost in Comfy credits", () => {
    for (const m of TEXT_MODELS.filter(isPaid)) {
      expect(messageCredits(m).cap * USD_PER_COMFY_CREDIT, m.id).toBeGreaterThanOrEqual(turnCostUsd(m, MAX_TURN));
      for (const usd of [0.001, 0.02, 0.07, 0.12]) {
        expect(settleCredits(m, usd) * USD_PER_COMFY_CREDIT, `${m.id} ${usd}`).toBeGreaterThanOrEqual(Math.min(usd, turnCostUsd(m, MAX_TURN)));
      }
    }
  });

  it("shows the paid models' credits publicly, the free ones without", () => {
    const list = publicTextModels();
    expect(list.find((m) => m.id === "claude-fable-5-1")).toMatchObject({ paid: true, credits: { typical: 15, cap: 33 } });
    expect(list.find((m) => m.id === "claude-sonnet-5-5")).toMatchObject({ paid: false });
    expect(list.find((m) => m.id === "claude-sonnet-5-5")).not.toHaveProperty("credits");
  });
});
