import { describe, expect, it } from "vitest";
import type { CreditEntry } from "@/core/credits";
import { usageBreakdown } from "./usage";

let n = 0;
const job = (model: string, amount: number, origin: "web" | "mcp" | "cli" | "api" = "web", state: "charged" | "reserved" | "refunded" = "charged"): CreditEntry => ({
  kind: "job", id: `j${++n}`, at: n, credits: -amount, balance: 0, jobId: `j${n}`, jobType: model.toLowerCase().replace(/\W+/g, "_"), model, state, amount, origin,
});

describe("usage breakdown", () => {
  it("adds up charged jobs by model, biggest first, the rest as one line", () => {
    const entries = [
      job("Veo 3.1 Lite", 85), job("Veo 3.1 Lite", 45), job("Seedream 4.5", 10), job("Kling 3.0", 95),
      job("FLUX.2 Pro", 8), job("Wan 2.7", 120, "web", "reserved"), job("Seedream 4.5", 10, "web", "refunded"),
    ];
    expect(usageBreakdown(entries, 2).models).toEqual([
      { key: "veo_3_1_lite", model: "Veo 3.1 Lite", credits: 130, jobs: 2 },
      { key: "kling_3_0", model: "Kling 3.0", credits: 95, jobs: 1 },
      { key: "rest", model: "2 weitere", credits: 18, jobs: 2 },
    ]);
  });

  it("splits what was spent by channel and counts Director messages apart", () => {
    const entries: CreditEntry[] = [
      job("Veo 3.1 Lite", 85, "mcp"), job("Seedream 4.5", 10), job("Seedream 4.5", 10, "cli"), job("Seedream 4.5", 10, "cli", "reserved"),
      { kind: "director", id: "d1", at: 9, credits: -16, balance: 0, model: "Claude Fable 5.1", state: "charged", amount: 16 },
      { kind: "grant", id: "g1", at: 1, credits: 100, balance: 100, source: "welcome" },
    ];
    const u = usageBreakdown(entries);
    expect(u.origins).toEqual([
      { origin: "web", credits: 10, jobs: 1 },
      { origin: "mcp", credits: 85, jobs: 1 },
      { origin: "cli", credits: 10, jobs: 1 },
    ]);
    expect(u.director).toEqual({ credits: 16, messages: 1 });
    expect(usageBreakdown([]).models).toEqual([]);
  });
});
