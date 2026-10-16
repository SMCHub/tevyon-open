import { catalog } from "@/core/catalog";
import { composeRecipeJob, LISTED_RECIPES, publicRecipe } from "@/core/recipes";
import { presetRun } from "@/server/models";
import { runtime } from "@/server/runtime";

const SAMPLE_IMAGE = "/api/media/uploads/00000000-0000-4000-8000-000000000000/sample.jpg";

/**
 * Public preset list with the price of one run. Recipe prompts stay on the server. A preset whose job type is not in
 * the register is left out.
 */
export async function GET() {
  const rt = await runtime();
  const presets = LISTED_RECIPES.flatMap((r) => {
    // Neither the photo nor a spoken line changes the price; a line preset gets its placeholder line.
    const job = composeRecipeJob(r, { image: SAMPLE_IMAGE, wish: r.line?.placeholder });
    if (!job.ok) return [{ ...publicRecipe(r), credits: null }];
    const run = presetRun(job, catalog);
    if (!run.ok) return [];
    const q = rt.jobs.quote(run.jobType, run.params);
    return [{ ...publicRecipe(r), credits: q.ok ? q.credits : null }];
  });
  return Response.json({ presets });
}
