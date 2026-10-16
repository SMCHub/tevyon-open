import { createHmac, timingSafeEqual } from "node:crypto";
import { CREDIT_PACKS, PLANS, type CreditPack, type Plan, type PlanId } from "./pricing";
import type { JobRepository } from "./repository";
import { createMemorySubscriptions, currentSubscription, isLive, type SubscriptionRecord, type SubscriptionStore, type SubscriptionStatus } from "./subscriptions";

/**
 * Buying credits: one-time packs and monthly plans (pricing.ts) through a payment provider (Stripe Checkout, Stripe
 * Billing). The server alone decides what a pack or plan costs and gives. A paid session or invoice is credited exactly
 * once, whoever reports it first (grant refs `stripe:<session id>` for packs, `sub:<invoice id>` for a plan's month).
 */
export type CheckoutRequest = { accountId: string; email?: string; pack: CreditPack; successUrl: string; cancelUrl: string };

/** A plan checkout. `customerId`: the account's customer at the provider, if it ever had a plan (one customer per account). */
export type PlanCheckoutRequest = { accountId: string; email?: string; customerId?: string; plan: Plan; successUrl: string; cancelUrl: string };

/**
 * A paid plan invoice as the payment provider reports it. `planId` and `periodEnd` come from the invoice line that
 * bills the plan (on an upgrade: the line for the new plan). Amounts in Rappen.
 */
export type PlanInvoice = {
  id: string;
  subscriptionId: string;
  accountId: string;
  /** create: the first month; cycle: a renewal; update: an upgrade in the middle of the month (prorated). */
  reason: "create" | "cycle" | "update" | "other";
  currency: string;
  amountPaid: number;
  paid: boolean;
  planId?: PlanId;
  /** End of the month the invoice pays (ms): its credits expire then. */
  periodEnd: number;
  /** The payment behind it: refunds and disputes only name the payment. */
  paymentIntent?: string;
};

/** What the return page of a plan checkout learns from the provider. */
export type PlanSession = { accountId: string; invoice?: PlanInvoice; subscription?: SubscriptionRecord };

/** The plan as the Studio shows it. */
export type SubscriptionView = { planId: PlanId; status: SubscriptionStatus; currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean };

/** What the provider says about a checkout session. `credits` and `amount` are what the session promised when it was created. */
export type PaidSession = {
  id: string;
  accountId: string;
  credits: number;
  /** Promised price in Rappen. */
  amount: number;
  /** Charged price in Rappen. */
  amountTotal: number;
  currency: string;
  paid: boolean;
  /** The payment behind the session: refunds and disputes name only the payment. */
  paymentIntent?: string;
};

/**
 * A payment that went back, as the payment provider reports it. Amounts in Rappen; a refund names the total refunded
 * so far (partial refunds report again with a higher total).
 */
export type PaymentReversal =
  | { kind: "refund"; paymentIntent: string; amountRefunded: number }
  | { kind: "dispute"; paymentIntent: string; disputeId: string; amount: number; status: "open" | "won" | "lost" };

/** Payment provider port. Server-only: keys and provider details never reach a client. */
export interface PaymentGateway {
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  getSession(id: string): Promise<PaidSession | undefined>;
  /** Monthly plans: a hosted checkout for the plan's recurring price. */
  createPlanCheckout?(req: PlanCheckoutRequest): Promise<{ id: string; url: string }>;
  /** The provider's customer portal: cancel, switch plan, payment method, invoices. */
  createPortal?(customerId: string, returnUrl: string): Promise<{ url: string }>;
  getPlanSession?(id: string): Promise<PlanSession | undefined>;
}

export type PackView = CreditPack & { rappenPerCredit: number; saving: number };
export type PlanView = Plan & { rappenPerCredit: number };

const rappen = (p: { priceChf: number; credits: number }) => Number(((p.priceChf / p.credits) * 100).toFixed(4));

/** Packs as the billing API lists them: the price per credit and the saving against the first (smallest) pack. */
export function packViews(packs: readonly CreditPack[] = CREDIT_PACKS): PackView[] {
  const base = packs[0]!.priceChf / packs[0]!.credits;
  return packs.map((p) => ({ ...p, rappenPerCredit: rappen(p), saving: Math.round((1 - p.priceChf / p.credits / base) * 100) }));
}

/** Monthly plans as the billing API lists them, with their price per credit. */
export function planViews(): PlanView[] {
  return PLANS.map((p) => ({ ...p, rappenPerCredit: rappen(p) }));
}

type Fail<E extends string> = { ok: false; error: E };

type BillingRepo = Pick<JobRepository, "grant" | "purchaseByPayment" | "debit" | "voidDebit" | "debits" | "owed">;

export function createBilling(deps: { repo: BillingRepo; gateway?: PaymentGateway; packs?: readonly CreditPack[]; subscriptions?: SubscriptionStore }) {
  const { repo, gateway, packs = CREDIT_PACKS, subscriptions = createMemorySubscriptions() } = deps;
  const plans = planViews;

  async function subscribe(
    accountId: string, planId: string, urls: { successUrl: string; cancelUrl: string }, email?: string,
  ): Promise<{ ok: true; url: string } | Fail<"unknown_plan" | "payments_unavailable" | "plan_exists">> {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) return { ok: false, error: "unknown_plan" };
    if (!gateway?.createPlanCheckout) return { ok: false, error: "payments_unavailable" };
    const mine = await subscriptions.ofAccount(accountId);
    // A second plan would bill twice; switching runs through the customer portal.
    if (mine.some(isLive)) return { ok: false, error: "plan_exists" };
    const customerId = currentSubscription(mine)?.customerId;
    const session = await gateway.createPlanCheckout({ accountId, plan, ...urls, ...(email ? { email } : {}), ...(customerId ? { customerId } : {}) });
    return { ok: true, url: session.url };
  }

  /**
   * Credits a paid plan invoice once (webhook and return page), and they expire with the month it pays. One rule for
   * every invoice: what was paid, at the plan's price per credit, rounded down and at most the plan's monthly credits.
   * A full month gives the plan's credits; an upgrade in the middle of the month gives the prorated difference; a month
   * paid partly from a Stripe balance gives its share. No credit ever sells below its plan's price.
   */
  async function fulfilPlanInvoice(inv: PlanInvoice): Promise<{ ok: true; credits: number } | Fail<"not_paid" | "amount_mismatch" | "unknown_plan" | "invalid_invoice">> {
    if (!inv.paid) return { ok: false, error: "not_paid" };
    if (!inv.accountId || !inv.id) return { ok: false, error: "invalid_invoice" };
    const plan = PLANS.find((p) => p.id === inv.planId);
    if (!plan) return { ok: false, error: "unknown_plan" };
    if (inv.currency.toLowerCase() !== "chf") return { ok: false, error: "amount_mismatch" };
    const credits = inv.reason === "other" ? 0 : Math.min(plan.credits, Math.floor((inv.amountPaid / Math.round(plan.priceChf * 100)) * plan.credits));
    if (credits <= 0) return { ok: true, credits: 0 };
    await repo.grant(inv.accountId, credits, `sub:${inv.id}`, inv.paymentIntent ? { intent: inv.paymentIntent, amount: inv.amountPaid } : undefined, { expiresAt: inv.periodEnd });
    return { ok: true, credits };
  }

  /** Stores the plan state the provider reports, unless a newer one is stored. */
  async function syncSubscription(s: SubscriptionRecord) {
    return subscriptions.upsert(s);
  }

  async function subscription(accountId: string): Promise<SubscriptionView | null> {
    const s = currentSubscription(await subscriptions.ofAccount(accountId));
    return s ? { planId: s.planId, status: s.status, currentPeriodEnd: s.currentPeriodEnd ?? null, cancelAtPeriodEnd: s.cancelAtPeriodEnd } : null;
  }

  async function portal(accountId: string, returnUrl: string): Promise<{ ok: true; url: string } | Fail<"no_subscription" | "payments_unavailable">> {
    if (!gateway?.createPortal) return { ok: false, error: "payments_unavailable" };
    const s = currentSubscription(await subscriptions.ofAccount(accountId));
    if (!s) return { ok: false, error: "no_subscription" };
    return { ok: true, url: (await gateway.createPortal(s.customerId, returnUrl)).url };
  }

  /** The return page of a plan checkout: books the first month and the plan state, for the account that paid only. */
  async function confirmPlan(accountId: string, sessionId: string) {
    if (!gateway?.getPlanSession) return { ok: false as const, error: "payments_unavailable" as const };
    const s = /^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId) ? await gateway.getPlanSession(sessionId) : undefined;
    if (!s || s.accountId !== accountId) return { ok: false as const, error: "not_found" as const };
    // The session's account, its subscription's and its invoice's come from different fields at the provider: all must agree.
    if ((s.invoice && s.invoice.accountId !== accountId) || (s.subscription && s.subscription.accountId !== accountId)) {
      return { ok: false as const, error: "not_found" as const };
    }
    if (s.subscription) await syncSubscription(s.subscription);
    if (!s.invoice) return { ok: false as const, error: "not_paid" as const };
    return fulfilPlanInvoice(s.invoice);
  }

  const packView = () => packViews(packs);

  async function checkout(
    accountId: string, packId: string, urls: { successUrl: string; cancelUrl: string }, email?: string,
  ): Promise<{ ok: true; url: string } | Fail<"unknown_pack" | "payments_unavailable">> {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return { ok: false, error: "unknown_pack" };
    if (!gateway) return { ok: false, error: "payments_unavailable" };
    const session = await gateway.createCheckout({ accountId, pack, ...urls, ...(email ? { email } : {}) });
    return { ok: true, url: session.url };
  }

  /** Credits a paid session once. Both the webhook and the return page end here. */
  async function fulfil(s: PaidSession): Promise<{ ok: true; credits: number } | Fail<"not_paid" | "amount_mismatch" | "invalid_session">> {
    if (!s.paid) return { ok: false, error: "not_paid" };
    if (s.currency.toLowerCase() !== "chf" || s.amountTotal !== s.amount) return { ok: false, error: "amount_mismatch" };
    if (!Number.isInteger(s.credits) || s.credits <= 0 || !s.accountId) return { ok: false, error: "invalid_session" };
    await repo.grant(s.accountId, s.credits, `stripe:${s.id}`, s.paymentIntent ? { intent: s.paymentIntent, amount: s.amountTotal } : undefined);
    return { ok: true, credits: s.credits };
  }

  /**
   * Takes back the credits of a refunded or disputed purchase, in proportion to the amount, once per event: what is
   * still available goes at once, the rest is owed and the next credits pay it first. A won dispute gives them back.
   */
  async function reverse(r: PaymentReversal): Promise<{ ok: true; taken: number; returned: number; owed: number } | Fail<"unknown_payment">> {
    const purchase = await repo.purchaseByPayment(r.paymentIntent);
    if (!purchase) return { ok: false, error: "unknown_payment" };
    const { accountId } = purchase;
    const credits = (rappen: number) => Math.min(purchase.credits, Math.round((purchase.credits * rappen) / purchase.amount));
    // A refunded plan month takes that month's own credits first while it runs; a pack takes bought credits first.
    const prefer = purchase.ref.startsWith("sub:") ? { preferGrant: purchase.ref } : {};
    const booked = await repo.debits(accountId);
    let taken = 0;
    let returned = 0;
    if (r.kind === "refund") {
      // amount_refunded is the payment's running total: the debit takes what it exceeds the refunds booked so far,
      // counted under the account lock, since Stripe may send two refund webhooks at the same time.
      const prefix = `refund:${r.paymentIntent}:`;
      const res = await repo.debit({
        accountId, credits: 0, ref: `${prefix}${r.amountRefunded}`, kind: "refund", upTo: { prefix, total: credits(r.amountRefunded) }, ...prefer,
      });
      if (res.ok) taken = res.collected + res.owed;
    } else {
      const ref = `dispute:${r.disputeId}`;
      const existing = booked.find((d) => d.ref === ref);
      if (r.status === "won") {
        if (existing && existing.state !== "void") {
          await repo.voidDebit(ref);
          returned = existing.credits;
        }
      } else if (!existing && credits(r.amount) > 0) {
        await repo.debit({ accountId, credits: credits(r.amount), ref, kind: "dispute", ...prefer });
        taken = credits(r.amount);
      }
    }
    return { ok: true, taken, returned, owed: await repo.owed(accountId) };
  }

  /** The return page: the signed-in account asks to have its own paid session credited. */
  async function confirm(accountId: string, sessionId: string) {
    if (!gateway) return { ok: false as const, error: "payments_unavailable" as const };
    const s = /^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId) ? await gateway.getSession(sessionId) : undefined;
    if (!s || s.accountId !== accountId) return { ok: false as const, error: "not_found" as const };
    return fulfil(s);
  }

  return {
    enabled: Boolean(gateway), plansEnabled: Boolean(gateway?.createPlanCheckout), packs: packView, plans, checkout, fulfil, confirm, reverse,
    subscribe, fulfilPlanInvoice, syncSubscription, subscription, portal, confirmPlan,
  };
}

/**
 * Stripe webhook signature: header `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.payload">`.
 * Rejects foreign secrets, altered payloads and events older than the tolerance (replays).
 */
export function verifyStripeSignature(payload: string, header: string, secret: string, now = Date.now(), toleranceSec = 300): boolean {
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  return parts
    .filter(([k, v]) => k === "v1" && /^[0-9a-f]{64}$/.test(v ?? ""))
    .some(([, v]) => timingSafeEqual(Buffer.from(v, "hex"), expected));
}
