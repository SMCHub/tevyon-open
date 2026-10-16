/** Keys are managed in the Studio only: an API key can neither list, create nor revoke keys. */
export const sessionOnly = () =>
  Response.json({ ok: false, error: "session_required", message: "API keys are managed in Tevyon Studio." }, { status: 403 });

/** Key changes come from the Studio's own pages, never from another site. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}
