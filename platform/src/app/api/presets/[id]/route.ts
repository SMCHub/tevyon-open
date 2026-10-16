import { catalog } from "@/core/catalog";
import { buildRecipeJob, findRecipe } from "@/core/recipes";
import { currentAccount, unauthorized } from "@/server/account";
import { startOptions } from "@/server/job-options";
import { presetRun } from "@/server/models";
import { runtime } from "@/server/runtime";

const STATUS: Record<string, number> = {
  unknown_recipe: 404, image_required: 400, line_required: 400, consent_required: 400, invalid_params: 400, unknown_job_type: 404, insufficient_credits: 402,
  price_changed: 409, model_paused: 503, model_retired: 410, key_limit_reached: 429,
};

/** One click: POST /api/presets/{id} with { image, wish?, consent: true, maxCredits? } starts the finished job at the price shown. */
/** Room for the worker pass that starts with this job (on Vercel it runs in this request via after()). */
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/presets/[id]">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { image?: unknown; wish?: unknown; consent?: unknown; maxCredits?: unknown };

  const image = typeof body.image === "string" ? body.image : undefined;
  // Only the caller's own uploads can be a start frame.
  if (image && !image.startsWith(`/api/media/uploads/${account.id}/`)) {
    return Response.json({ ok: false, error: "invalid_params" }, { status: 400 });
  }
  // Real people only with their consent.
  if (body.consent !== true) return Response.json({ ok: false, error: "consent_required" }, { status: 400 });

  const job = buildRecipeJob(id, { ...(image ? { image } : {}), ...(typeof body.wish === "string" ? { wish: body.wish } : {}) });
  if (!job.ok) return Response.json(job, { status: STATUS[job.error] ?? 400 });

  const run = presetRun(job, catalog);
  if (!run.ok) return Response.json({ ok: false, error: "unknown_job_type" }, { status: STATUS.unknown_job_type });

  const rt = await runtime();
  const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
  // Recipe prompts are already written for the model: the skill only tidies up (no extra LLM call).
  // The job carries its preset, so views show the preset and never the recipe prompt.
  const wish = typeof body.wish === "string" && body.wish.trim() ? body.wish.trim().slice(0, 200) : undefined;
  const recipe = { id, title: findRecipe(id)?.title ?? id, ...(wish ? { wish } : {}) };
  const res = await rt.jobs.start(account.id, run.jobType, run.params, { idempotencyKey, promptMode: "exact", recipe, ...startOptions(account, req, body) });
  return Response.json(res, { status: res.ok ? 202 : STATUS[res.error] ?? 400 });
}
