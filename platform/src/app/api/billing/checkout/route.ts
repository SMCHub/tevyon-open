import { currentAccount, unauthorized } from "@/server/account";
import { billing } from "@/server/billing";
import { publicBase } from "@/server/media-links";

const STATUS = { unknown_pack: 400, payments_unavailable: 503 } as const;

/** Starts a Stripe Checkout for one pack. Only from the Studio login: API keys cannot buy credits. */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account || account.via !== "session") return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { packId?: unknown };
  const base = publicBase(req);
  try {
    const res = await (await billing()).checkout(
      account.id, String(body.packId ?? ""),
      { successUrl: `${base}/credits?checkout={CHECKOUT_SESSION_ID}`, cancelUrl: `${base}/credits?checkout=cancel` },
      account.email,
    );
    return Response.json(res, { status: res.ok ? 200 : STATUS[res.error] });
  } catch (e) {
    console.error("[billing] checkout failed", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: "payment_provider_error" }, { status: 502 });
  }
}
