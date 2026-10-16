import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen: { fulfil: unknown[]; reverse: unknown[]; plans: unknown[]; states: unknown[] } = { fulfil: [], reverse: [], plans: [], states: [] };
/** The plans' Stripe prices as the setup script creates them (looked up by lookup_key in production). */
const PRICES = new Map([["price_2000", "monat-2000"], ["price_5000", "monat-5000"], ["price_25000", "monat-25000"]] as const);
vi.mock("@/server/billing", async () => {
  const { toPlanInvoice, toSubscriptionState } = await import("@/server/stripe");
  return {
    billing: async () => ({
      fulfil: async (s: unknown) => (seen.fulfil.push(s), { ok: true, credits: 1_000 }),
      reverse: async (r: unknown) => (seen.reverse.push(r), { ok: true, taken: 1_000, returned: 0, owed: 0 }),
      fulfilPlanInvoice: async (inv: { planId?: string }) => (seen.plans.push(inv), inv.planId ? { ok: true, credits: 2_000 } : { ok: false, error: "unknown_plan" }),
      syncSubscription: async (s: unknown) => (seen.states.push(s), true),
    }),
    stripeGateway: () => ({
      readPlanInvoice: async (raw: Parameters<typeof toPlanInvoice>[0]) => (raw.parent?.type === "subscription_details" ? toPlanInvoice(raw, PRICES, "pi_sub") : undefined),
      readSubscription: async (raw: Parameters<typeof toSubscriptionState>[0], at: number) => toSubscriptionState(raw, at, PRICES),
    }),
  };
});

const { POST } = await import("./route");

const SECRET = "whsec_route_test";
const ACC = "00000000-0000-4000-8000-0000000000b1";

/** An event as Stripe sends it: JSON body, signed with the endpoint secret and the current time. */
function stripeEvent(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return new Request("http://localhost:3100/api/billing/webhook", { method: "POST", body: payload, headers: { "stripe-signature": `t=${t},v1=${v1}` } });
}

const session = {
  object: "checkout.session", id: "cs_test_1", client_reference_id: ACC, metadata: { app: "tevyon", accountId: ACC, credits: "1000", amount: "1000" },
  amount_total: 1000, currency: "chf", payment_status: "paid", payment_intent: "pi_1",
};

const MONTH_START = 1_792_060_000;
const MONTH_END = MONTH_START + 31 * 86_400;
const planLine = (price: string, amount: number, proration = false, start = MONTH_START) => ({
  object: "line_item", amount, currency: "chf", period: { start, end: MONTH_END },
  pricing: { type: "price_details", price_details: { price, product: "prod_x" } },
  parent: { type: "subscription_item_details", subscription_item_details: { proration, subscription: "sub_1", subscription_item: "si_1" } },
});
const planInvoice = (changes: object = {}) => ({
  object: "invoice", id: "in_1", status: "paid", billing_reason: "subscription_create", currency: "chf", amount_paid: 1800,
  parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { app: "tevyon", accountId: ACC, planId: "monat-2000" } } },
  lines: { object: "list", data: [planLine("price_2000", 1800)] },
  ...changes,
});
const subscription = {
  object: "subscription", id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: true, cancel_at: null,
  metadata: { app: "tevyon", accountId: ACC, planId: "monat-2000" },
  items: { object: "list", data: [{ object: "subscription_item", current_period_end: MONTH_END, price: { id: "price_5000", lookup_key: "monat-5000" } }] },
};

describe("Stripe webhook route", () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    for (const list of Object.values(seen)) list.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it("credits a paid checkout once Stripe's signature checks out, with the payment behind it", async () => {
    const res = await POST(stripeEvent({ type: "checkout.session.completed", data: { object: session } }));

    expect(res.status).toBe(200);
    expect(seen.fulfil).toEqual([expect.objectContaining({ id: "cs_test_1", accountId: ACC, credits: 1000, paid: true, paymentIntent: "pi_1" })]);
  });

  it("takes credits back for a refund and gives them back for a won dispute", async () => {
    await POST(stripeEvent({ type: "charge.refunded", data: { object: { object: "charge", payment_intent: "pi_1", amount: 1000, amount_refunded: 1000 } } }));
    await POST(stripeEvent({ type: "charge.dispute.closed", data: { object: { object: "dispute", id: "dp_1", payment_intent: "pi_1", amount: 1000, status: "won" } } }));

    expect(seen.reverse).toEqual([
      { kind: "refund", paymentIntent: "pi_1", amountRefunded: 1000 },
      { kind: "dispute", paymentIntent: "pi_1", disputeId: "dp_1", amount: 1000, status: "won" },
    ]);
  });

  it("credits a plan's month from its paid invoice, with the plan, the month's end and the payment behind it", async () => {
    const res = await POST(stripeEvent({ type: "invoice.paid", created: MONTH_START, data: { object: planInvoice() } }));

    expect(res.status).toBe(200);
    expect(seen.plans).toEqual([{
      id: "in_1", subscriptionId: "sub_1", accountId: ACC, reason: "create", currency: "chf", amountPaid: 1800, paid: true,
      planId: "monat-2000", periodEnd: MONTH_END * 1000, paymentIntent: "pi_sub",
    }]);
  });

  it("reads an upgrade in the middle of the month from the new plan's proration line", async () => {
    const lines = { object: "list", data: [planLine("price_2000", -900, true, MONTH_START + 15 * 86_400), planLine("price_25000", 8750, true, MONTH_START + 15 * 86_400)] };

    await POST(stripeEvent({ type: "invoice.paid", data: { object: planInvoice({ id: "in_up", billing_reason: "subscription_update", amount_paid: 7850, lines }) } }));

    expect(seen.plans).toMatchObject([{ id: "in_up", reason: "update", planId: "monat-25000", amountPaid: 7850, periodEnd: MONTH_END * 1000 }]);
  });

  it("asks Stripe to retry an invoice whose price is no plan it knows, and ignores invoices of no plan", async () => {
    const unknown = planInvoice({ lines: { object: "list", data: [planLine("price_other", 1800)] } });
    expect((await POST(stripeEvent({ type: "invoice.paid", data: { object: unknown } }))).status).toBe(500);

    expect((await POST(stripeEvent({ type: "invoice.paid", data: { object: planInvoice({ parent: null }) } }))).status).toBe(200);
    expect(seen.plans).toHaveLength(1);
  });

  it("keeps the plan state from subscription events, stamped with the event time", async () => {
    const res = await POST(stripeEvent({ type: "customer.subscription.updated", created: MONTH_START + 60, data: { object: subscription } }));

    expect(res.status).toBe(200);
    expect(seen.states).toEqual([{
      id: "sub_1", accountId: ACC, customerId: "cus_1", planId: "monat-5000", status: "active", currentPeriodEnd: MONTH_END * 1000,
      cancelAtPeriodEnd: true, eventAt: (MONTH_START + 60) * 1000,
    }]);
  });

  it("leaves a plan's checkout to its invoice: the session itself credits nothing", async () => {
    const planSession = { object: "checkout.session", id: "cs_sub_1", mode: "subscription", client_reference_id: ACC, metadata: { accountId: ACC, planId: "monat-2000" }, payment_status: "paid" };

    expect((await POST(stripeEvent({ type: "checkout.session.completed", data: { object: planSession } }))).status).toBe(200);
    expect(seen.fulfil).toEqual([]);
  });

  it("answers 200 and books nothing for payments of other businesses on the same Stripe account", async () => {
    // Same metadata names as ours, but without Tevyon's mark: a shop's payment link, another app's plan.
    const foreign = { accountId: ACC, planId: "monat-2000", credits: "1000", amount: "1000" };
    const theirInvoice = planInvoice({
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_9", metadata: foreign } },
      lines: { object: "list", data: [planLine("price_their_own", 4900)] },
    });
    const events = [
      { type: "checkout.session.completed", data: { object: { ...session, metadata: foreign } } },
      { type: "invoice.paid", data: { object: theirInvoice } },
      { type: "customer.subscription.updated", data: { object: { ...subscription, metadata: foreign } } },
      { type: "charge.refunded", data: { object: { object: "charge", payment_intent: "pi_their_own", amount: 4900, amount_refunded: 4900 } } },
    ];

    for (const event of events) expect((await POST(stripeEvent(event))).status, event.type).toBe(200);
    expect([seen.fulfil, seen.plans, seen.states]).toEqual([[], [], []]);
  });

  it("does nothing for a forged event, nothing without a configured secret, and ignores events it does not handle", async () => {
    expect((await POST(stripeEvent({ type: "checkout.session.completed", data: { object: session } }, "whsec_someone_else"))).status).toBe(400);
    expect((await POST(stripeEvent({ type: "customer.created", data: { object: {} } }))).status).toBe(200);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await POST(stripeEvent({ type: "checkout.session.completed", data: { object: session } }))).status).toBe(503);

    expect([seen.fulfil, seen.reverse]).toEqual([[], []]);
  });
});
