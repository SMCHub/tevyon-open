import { currentAccount, unauthorized } from "@/server/account";
import { billing } from "@/server/billing";
import { publicBase } from "@/server/media-links";

const STATUS = { unknown_plan: 400, plan_exists: 409, payments_unavailable: 503 } as const;

/** Starts a Stripe Checkout for a monthly plan. Only from the Studio login: API keys cannot buy. */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account || account.via !== "session") return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { planId?: unknown };
  const base = publicBase(req);
  try {
    const res = await (await billing()).subscribe(
      account.id, String(body.planId ?? ""),
      { successUrl: `${base}/credits?abo={CHECKOUT_SESSION_ID}`, cancelUrl: `${base}/credits?abo=cancel` },
      account.email,
    );
    return Response.json(res, { status: res.ok ? 200 : STATUS[res.error] });
  } catch (e) {
    console.error("[billing] plan checkout failed", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: "payment_provider_error" }, { status: 502 });
  }
}
