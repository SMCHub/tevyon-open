import { createBilling } from "@/core/billing";
import { createMemorySubscriptions, createPostgresSubscriptions, type SubscriptionStore } from "@/core/subscriptions";
import { createPgDb } from "./db";
import { runtime } from "./runtime";
import { createStripeGateway, type StripeGateway } from "./stripe";

/** Kept across hot reloads like the runtime: one Stripe client (its price cache) and one subscription store per process. */
const g = globalThis as unknown as { __tachyonStripe?: { key: string; gateway: StripeGateway }; __tachyonSubscriptions?: SubscriptionStore };

/**
 * Stripe for this server when STRIPE_SECRET_KEY is set (a restricted key rk_…, see stripe.ts for its permissions),
 * otherwise packs and plans are shown but cannot be bought yet.
 */
export function stripeGateway(): StripeGateway | undefined {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return undefined;
  if (g.__tachyonStripe?.key !== key) {
    g.__tachyonStripe = { key, gateway: createStripeGateway({ secretKey: key, ...(process.env.STRIPE_PORTAL_CONFIGURATION ? { portalConfiguration: process.env.STRIPE_PORTAL_CONFIGURATION } : {}) }) };
  }
  return g.__tachyonStripe.gateway;
}

/** Plans as Stripe reports them: in the database when there is one, else in memory (dev without DATABASE_URL). */
function subscriptions(): SubscriptionStore {
  const url = process.env.DATABASE_URL;
  return (g.__tachyonSubscriptions ??= url ? createPostgresSubscriptions(createPgDb(url)) : createMemorySubscriptions());
}

export async function billing() {
  const gateway = stripeGateway();
  return createBilling({ repo: (await runtime()).repo, subscriptions: subscriptions(), ...(gateway ? { gateway } : {}) });
}
