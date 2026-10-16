import { currentAccount } from "@/server/account";
import { billing } from "@/server/billing";

/**
 * Packs and monthly plans with their price per credit, whether they can be bought on this server yet, and for a signed-in
 * account its plan. Public: the price page shows it to visitors too.
 */
export async function GET() {
  const [b, account] = await Promise.all([billing(), currentAccount().catch(() => null)]);
  // The price list must answer even if the plan lookup does not (it is a convenience for the signed-in view).
  const subscription = account
    ? await b.subscription(account.id).catch((e: unknown) => (console.warn("[billing] plan lookup failed", e instanceof Error ? e.message : e), null))
    : null;
  return Response.json(
    { enabled: b.enabled, plansEnabled: b.plansEnabled, packs: b.packs(), plans: b.plans(), subscription },
    { headers: { "cache-control": "no-store" } },
  );
}
