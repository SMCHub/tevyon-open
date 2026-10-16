import { currentAccount, unauthorized } from "@/server/account";
import { billing } from "@/server/billing";

const STATUS = {
  not_found: 404, not_paid: 409, amount_mismatch: 409, invalid_session: 409, invalid_invoice: 409, unknown_plan: 409, payments_unavailable: 503,
} as const;

/**
 * The return page after Stripe: credits the account's own paid session (idempotent with the webhook). `kind: "plan"`
 * for a plan checkout: books its first month and the plan state.
 */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account || account.via !== "session") return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { sessionId?: unknown; kind?: unknown };
  try {
    const b = await billing();
    const sessionId = String(body.sessionId ?? "");
    const res = body.kind === "plan" ? await b.confirmPlan(account.id, sessionId) : await b.confirm(account.id, sessionId);
    return Response.json(res, { status: res.ok ? 200 : STATUS[res.error] });
  } catch (e) {
    console.error("[billing] confirm failed", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: "payment_provider_error" }, { status: 502 });
  }
}
