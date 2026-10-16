import { catalog } from "@/core/catalog";
import { currentAccount, unauthorized } from "@/server/account";
import { publicBase } from "@/server/media-links";
import { consentUrl, requestConsent } from "@/server/person-consent";
import { runtime } from "@/server/runtime";

const STATUS = { unknown_job_type: 404, not_needed: 400, invalid_params: 400 } as const;

/**
 * POST /api/consent { jobType, params }: a consent request for a job that shows real people (Face Swap, Character
 * Swap), started over the API or the CLI. The answer carries `url`: the person opens it signed in to Tevyon and
 * confirms; then POST /api/jobs/{job_type} with `consentId` starts the job once, with exactly these pictures.
 */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { jobType?: unknown; params?: unknown };
  const jobType = typeof body.jobType === "string" ? body.jobType : "";
  const res = await requestConsent(catalog, (await runtime()).consent, account.id, jobType, body.params ?? {});
  if (!res.ok) return Response.json(res, { status: STATUS[res.error] });
  return Response.json({ ok: true, id: res.id, url: consentUrl(publicBase(req), res.id), expiresAt: new Date(res.expiresAt).toISOString() }, { status: 201 });
}
