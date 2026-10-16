import { currentAccount, unauthorized } from "@/server/account";
import { startOptions } from "@/server/job-options";
import { marketingOverview, startMarketing, type MsStartBody } from "@/server/marketing";
import { runtime } from "@/server/runtime";

const STATUS: Record<string, number> = {
  unknown_style: 404, style_unavailable: 503, product_image_required: 400, avatar_required: 400, avatar_not_supported: 400,
  ad_reference_not_supported: 400, poster_content_required: 400, aspect_ratio_invalid: 400, duration_invalid: 400, line_required: 400,
  batch_size_invalid: 400, consent_required: 400, invalid_params: 400, unknown_job_type: 404, insufficient_credits: 402,
  price_changed: 409, model_paused: 503, model_retired: 410, key_limit_reached: 429,
};

/** Marketing Agent: categories and styles with the price of one run. Prompts stay on the server. */
export async function GET() {
  const account = await currentAccount();
  if (!account) return unauthorized();
  return Response.json(marketingOverview(await runtime()));
}

/**
 * POST /api/marketing with { styleId, product?, avatar?, adReference?, wish?, aspect?, duration?, count?, consent?, maxCredits? }
 * starts the style count times (1–4) at the price shown per run. Header Idempotency-Key.
 */
/** Room for the worker pass that starts with this job (on Vercel it runs in this request via after()). */
export const maxDuration = 300;

export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as MsStartBody;
  const res = await startMarketing(await runtime(), account.id, body, {
    idempotencyKey: req.headers.get("idempotency-key") ?? undefined,
    ...startOptions(account, req, body),
  });
  return Response.json(res, { status: res.ok ? 202 : STATUS[res.error] ?? 400 });
}
