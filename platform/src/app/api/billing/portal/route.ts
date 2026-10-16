import { currentAccount, unauthorized } from "@/server/account";
import { billing } from "@/server/billing";
import { publicBase } from "@/server/media-links";

const STATUS = { no_subscription: 404, payments_unavailable: 503 } as const;

/** Opens Stripe's customer portal for the account's plan: cancel, switch plan, payment method, invoices. */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account || account.via !== "session") return unauthorized();
  try {
    const res = await (await billing()).portal(account.id, `${publicBase(req)}/credits`);
    return Response.json(res, { status: res.ok ? 200 : STATUS[res.error] });
  } catch (e) {
    console.error("[billing] portal failed", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: "payment_provider_error" }, { status: 502 });
  }
}
