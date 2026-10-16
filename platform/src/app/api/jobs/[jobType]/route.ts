import { currentAccount, unauthorized } from "@/server/account";
import { publicBase } from "@/server/media-links";
import { checkImageUrl } from "@/server/remote-image";
import { webhookSecret } from "@/server/webhook-secret";
import { startOptions } from "@/server/job-options";
import { runtime } from "@/server/runtime";

const STATUS = {
  unknown_job_type: 404, invalid_params: 400, insufficient_credits: 402, price_changed: 409, model_paused: 503, model_retired: 410,
  key_limit_reached: 429,
  // Jobs that show real people, started outside the Studio: a person confirms in Tevyon first (POST /api/consent).
  consent_required: 403, consent_invalid: 403, consent_declined: 403, consent_pending: 409, consent_used: 409, consent_expired: 410,
} as const;

/**
 * One generic endpoint for every model: POST /api/jobs/{job_type}.
 * Input files (start image) are checked in the core: only the account's own uploads, for every channel.
 * Body `maxCredits`: the price the caller showed; a higher current price answers 409 price_changed with the new price.
 * Body `consentId`: for Face Swap and Character Swap outside the Studio, a consent the person confirmed (POST /api/consent).
 * Body `webhookUrl`: a public https address that gets the finished job as a signed POST (core/webhooks.ts).
 */
/** Room for the worker pass that starts with this job (on Vercel it runs in this request via after()). */
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[jobType]">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { jobType } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { params?: unknown; promptMode?: unknown; basedOn?: unknown; maxCredits?: unknown; consentId?: unknown; webhookUrl?: unknown };
  const params = (body.params ?? {}) as Record<string, unknown>;
  // "exact": the caller's own finished prompt, sent unchanged. Default "auto": Tevyon writes it with the prompt skill.
  const promptMode = body.promptMode === "exact" ? "exact" : "auto";
  const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
  // Draft → final: the id of the draft job; the final reuses its written prompt when the words are the same.
  const basedOn = typeof body.basedOn === "string" ? body.basedOn : undefined;
  // A webhook address is checked before anything starts.
  const webhookUrl = typeof body.webhookUrl === "string" ? body.webhookUrl : undefined;
  if (webhookUrl !== undefined) {
    const checked = webhookSecret(account.id) ? checkImageUrl(webhookUrl) : ({ ok: false, reason: "webhooks are not available" } as const);
    if (!checked.ok) return Response.json({ ok: false, error: "invalid_params", issues: [`webhookUrl: ${checked.reason}`] }, { status: 400 });
  }
  const rt = await runtime();
  const res = await rt.jobs.start(account.id, jobType, params, {
    idempotencyKey, promptMode, ...(basedOn ? { basedOn } : {}), ...(typeof body.consentId === "string" ? { consentId: body.consentId } : {}),
    ...startOptions(account, req, body),
  });
  if (res.ok && webhookUrl !== undefined) await rt.webhooks.register(res.job.id, account.id, webhookUrl, publicBase(req));
  return Response.json(res, { status: res.ok ? 202 : STATUS[res.error] });
}
