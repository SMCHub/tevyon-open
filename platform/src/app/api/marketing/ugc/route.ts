import { currentAccount, unauthorized } from "@/server/account";
import { startOptions } from "@/server/job-options";
import { continueUgc, type UgcContinueBody } from "@/server/marketing";
import { runtime } from "@/server/runtime";

const STATUS: Record<string, number> = {
  invalid_params: 400, not_found: 404, frame_not_ready: 409, not_an_image: 415, line_required: 400, duration_invalid: 400, aspect_ratio_invalid: 400,
  style_unavailable: 503, insufficient_credits: 402, price_changed: 409, model_paused: 503, model_retired: 410, key_limit_reached: 429,
};

/**
 * UGC step 2: POST /api/marketing/ugc with { frameJobId, styleId, wish, duration, aspect, maxCredits } lets the finished
 * still speak. Idempotent per still: a second call returns the same video job.
 */
/** Room for the worker pass that starts with this job (on Vercel it runs in this request via after()). */
export const maxDuration = 300;

export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as UgcContinueBody;
  const res = await continueUgc(await runtime(), account.id, body, startOptions(account, req, body));
  return Response.json(res, { status: res.ok ? 202 : STATUS[res.error] ?? 400 });
}
