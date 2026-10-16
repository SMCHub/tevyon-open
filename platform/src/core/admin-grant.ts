/**
 * A manual credit grant by the operator (showcase jobs, goodwill). Booked through repo.grant with the ref
 * `admin:<account>:<reason>:<day>`, so a repeat for that account on the same day with the same reason books nothing
 * (refs are unique across all accounts, so the account belongs in it), and the statement shows a
 * manual adjustment, never a purchase (credits.ts: only stripe… refs are purchases). The reason stays server-side.
 */
export type AdminGrant = { ok: true; credits: number; ref: string } | { ok: false; error: "credits_out_of_range" | "reason_missing" };

export const MAX_ADMIN_GRANT = 5_000;

export function adminGrant(accountId: string, credits: number, reason: string, day: Date): AdminGrant {
  if (!Number.isInteger(credits) || credits < 1 || credits > MAX_ADMIN_GRANT) return { ok: false, error: "credits_out_of_range" };
  const slug = reason
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (slug.length < 3) return { ok: false, error: "reason_missing" };
  return { ok: true, credits, ref: `admin:${accountId}:${slug}:${day.toISOString().slice(0, 10)}` };
}
