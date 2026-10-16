/**
 * Mail to the operator about the community (a first report since the last review, a creation that reports took out).
 * Sent with Resend over plain HTTP when RESEND_API_KEY is set, to MODERATION_EMAIL or else OPERATOR_EMAILS
 * (comma-separated), from MAIL_FROM (default: Resend's test sender, which only delivers to the Resend account's own
 * address). Without a key it is a line in the server log. It never throws: a mail that fails must not fail the request
 * behind it. Run it with after() so the response does not wait.
 */
export async function notifyOperator(subject: string, lines: string[]): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = (process.env.MODERATION_EMAIL ?? process.env.OPERATOR_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const text = lines.join("\n");
  if (!key || to.length === 0) {
    console.warn(`[moderation] ${subject}${key ? " (no MODERATION_EMAIL)" : " (no RESEND_API_KEY, not mailed)"}\n${text}`);
    return;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM ?? "Tevyon Moderation <onboarding@resend.dev>", to, subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) console.warn(`[moderation] mail failed: HTTP ${r.status}`);
  } catch (e) {
    console.warn("[moderation] mail failed", e);
  }
}

/** German labels of the report reasons, for the operator's mail and page. */
export const REASON_LABEL: Record<string, string> = {
  rights: "Rechte verletzt",
  person: "Reale Person ohne Einwilligung",
  sexual: "Sexuelle Inhalte",
  violence: "Gewalt, Hass oder Hetze",
  minors: "Minderjährige",
  other: "Anderes",
};
