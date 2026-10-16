import type { CreditEntry } from "@/core/credits";
import type { JobOrigin } from "@/core/repository";

export type ModelUsage = { key: string; model: string; credits: number; jobs: number };
export type OriginUsage = { origin: JobOrigin; credits: number; jobs: number };

const ORIGINS: JobOrigin[] = ["web", "mcp", "cli", "api"];

/**
 * What the account spent, from its statement (/api/credits): charged jobs by model (the `top` biggest, the rest in one
 * line) and by channel (Studio, MCP, CLI, API), and Director messages apart. Reserved and refunded jobs cost nothing.
 */
export function usageBreakdown(entries: CreditEntry[], top = 5) {
  const models = new Map<string, ModelUsage>();
  const origins = new Map<JobOrigin, OriginUsage>();
  const director = { credits: 0, messages: 0 };
  for (const e of entries) {
    if (e.kind === "director" && e.state === "charged") {
      director.credits += e.amount;
      director.messages += 1;
    }
    if (e.kind !== "job" || e.state !== "charged") continue;
    const m = models.get(e.jobType) ?? { key: e.jobType, model: e.model, credits: 0, jobs: 0 };
    m.credits += e.amount;
    m.jobs += 1;
    models.set(e.jobType, m);
    const o = origins.get(e.origin) ?? { origin: e.origin, credits: 0, jobs: 0 };
    o.credits += e.amount;
    o.jobs += 1;
    origins.set(e.origin, o);
  }
  const sorted = [...models.values()].sort((a, b) => b.credits - a.credits || a.model.localeCompare(b.model));
  const rest = sorted.slice(top);
  return {
    models: rest.length
      ? [...sorted.slice(0, top), { key: "rest", model: `${rest.length} weitere`, credits: rest.reduce((s, m) => s + m.credits, 0), jobs: rest.reduce((s, m) => s + m.jobs, 0) }]
      : sorted,
    origins: ORIGINS.flatMap((o) => origins.get(o) ?? []),
    director,
  };
}
