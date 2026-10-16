import { buildRecipeJob, composeRecipeJob, findRecipe, LISTED_RECIPES, publicRecipe, type Recipe } from "../core/recipes";
import type { Register } from "../core/register";
import type { McpDeps, McpPreset } from "./mcp";
import { presetRun } from "./models";

/** Any upload path prices a preset: neither the photo nor a spoken line changes what a run costs. */
const SAMPLE_IMAGE = "/api/media/uploads/00000000-0000-4000-8000-000000000000/sample.jpg";

/**
 * Presets for the MCP server (list_presets, run_preset), the same as GET /api/presets and POST /api/presets/{id}:
 * public fields with the price of one run, and the job a run is. A preset whose job type is not in the register is
 * left out. The recipe prompt goes into the job for the model only; the job's views show the preset (jobs.ts, publicParams).
 */
export function presetsForMcp(deps: {
  register: Pick<Register, "get">;
  quote(jobType: string, params: Record<string, unknown>): number | null;
  /** The presets to list; the live ones unless a test passes drafts. */
  recipes?: Recipe[];
}): NonNullable<McpDeps["presets"]> {
  return {
    list(): McpPreset[] {
      return (deps.recipes ?? LISTED_RECIPES).flatMap((r) => {
        const pub = publicRecipe(r);
        const card = { id: pub.id, title: pub.title, tagline: pub.tagline, category: pub.category, needs: pub.needs, badge: pub.badge, wishHint: pub.wishHint, line: pub.line };
        // A line preset needs its line to compose; the placeholder stands in, it does not change the price.
        const job = composeRecipeJob(r, { image: SAMPLE_IMAGE, wish: r.line?.placeholder });
        if (!job.ok) return [{ ...card, credits: null }];
        const run = presetRun(job, deps.register);
        if (!run.ok) return [];
        return [{ ...card, credits: deps.quote(run.jobType, run.params) }];
      });
    },

    build(id, { image, wish }) {
      const job = buildRecipeJob(id, { image, ...(wish ? { wish } : {}) });
      if (!job.ok) return job;
      const run = presetRun(job, deps.register);
      if (!run.ok) return { ok: false, error: "unknown_job_type" };
      const recipe = { id, title: findRecipe(id)?.title ?? id, ...(wish ? { wish } : {}) };
      return { ok: true, jobType: run.jobType, params: run.params, recipe };
    },
  };
}
