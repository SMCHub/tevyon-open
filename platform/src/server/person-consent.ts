import type { Consent } from "@/core/consent";
import type { Register } from "@/core/register";

/** A request for consent, the same for HTTP (POST /api/consent) and MCP (request_consent). */
export type ConsentRequestResult =
  | { ok: true; id: string; expiresAt: number }
  | { ok: false; error: "unknown_job_type" | "not_needed" | "invalid_params"; issues?: string[] };

/**
 * Opens a consent request for a job that shows real people (core/consent.ts): bound to the pictures the job would
 * show, which must be the account's own uploads, because the confirmation page shows them to the person who confirms.
 */
export async function requestConsent(
  register: Register, consent: Pick<Consent, "request">, accountId: string, jobType: string, params: unknown,
): Promise<ConsentRequestResult> {
  const def = register.get(jobType);
  if (!def) return { ok: false, error: "unknown_job_type" };
  if (!def.consentImages) return { ok: false, error: "not_needed" };
  const parsed = def.params.safeParse(params);
  if (!parsed.success) return { ok: false, error: "invalid_params", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const images = def.consentImages(parsed.data);
  const own = `/api/media/uploads/${accountId}/`;
  if (images.some((i) => !i.startsWith(own))) return { ok: false, error: "invalid_params", issues: ["images: must be your own uploads"] };
  const res = await consent.request(accountId, jobType, images);
  return res.ok ? res : { ok: false, error: "invalid_params" };
}

/** The page a person opens to confirm, signed in to Tevyon. */
export const consentUrl = (base: string, id: string) => `${base}/consent/${id}`;
