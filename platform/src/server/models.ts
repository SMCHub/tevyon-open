import type { Availability } from "../core/availability";
import { resolveRecipeModel } from "../core/recipes";
import { publicParams, type JobTypeDef, type Register } from "../core/register";

/** Lifecycle as the public catalog shows it; retired job types are not shown at all. */
export function publicLifecycle(a: Availability): { status: "active" | "deprecated" | "paused"; retiresAt?: string; successor?: string } | null {
  if (a.ok) return { status: a.status, ...(a.retiresAt ? { retiresAt: a.retiresAt } : {}), ...(a.successor ? { successor: a.successor } : {}) };
  return a.reason === "paused" ? { status: "paused" } : null;
}

/**
 * The public catalog for the studio, the CLI and the MCP server: job types with name, schema and lifecycle.
 * promptMax: the prompt limit of a job type's skill (publicParams).
 */
export function publicCatalog(register: Register, availability: (jobType: string) => Availability, promptMax?: (def: JobTypeDef) => number | undefined) {
  return register.list().flatMap((d) => {
    const life = publicLifecycle(availability(d.jobType));
    if (!life) return [];
    return [{
      jobType: d.jobType,
      kind: d.kind,
      model: d.model,
      tagline: d.tagline,
      badge: d.badge ?? null,
      family: d.family ?? null,
      cover: null,
      params: publicParams(d, promptMax?.(d)),
      ...life,
    }];
  });
}

/** The job a preset runs today: its recipe's job, as long as the register has the job type. */
export function presetRun(
  job: { jobType: string; params: Record<string, unknown> },
  register: Pick<Register, "get">,
): { ok: true; jobType: string; params: Record<string, unknown> } | { ok: false; reason: "unknown" } {
  const r = resolveRecipeModel(job.jobType, register);
  return r.ok ? { ok: true, jobType: r.jobType, params: job.params } : r;
}

/** The register as agents should see it: retired job types left out of list(), still known to get() for running jobs. */
export function listedRegister(register: Register, availability: (jobType: string) => Availability): Register {
  return {
    get: (jobType) => register.get(jobType),
    list: () => register.list().filter((d) => publicLifecycle(availability(d.jobType)) !== null),
  };
}
