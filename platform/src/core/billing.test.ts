import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createBilling, verifyStripeSignature, type CheckoutRequest, type PaidSession, type PaymentGateway, type PlanCheckoutRequest, type PlanInvoice, type PlanSession,
} from "./billing";
import { createCredits } from "./credits";
import { createMemorySubscriptions, type SubscriptionRecord } from "./subscriptions";
import { repositories } from "./testing/repositories";

const ACC = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const URLS = { successUrl: "https://studio.test/credits?checkout={CHECKOUT_SESSION_ID}", cancelUrl: "https://studio.test/credits?checkout=cancel" };

/** A payment gateway that records checkouts and answers with scripted sessions. */
function fakeGateway() {
  const created: CheckoutRequest[] = [];
  const sessions = new Map<string, PaidSession>();
  const gateway: PaymentGateway & { created: CheckoutRequest[]; pay(id: string, changes?: Partial<PaidSession>): PaidSession } = {
    created,
    async createCheckout(req) {
      created.push(req);
      const id = `cs_test_${created.length}`;
      sessions.set(id, { id, accountId: req.accountId, credits: req.pack.credits, amount: req.pack.priceChf * 100, amountTotal: req.pack.priceChf * 100, currency: "chf", paid: false });
      return { id, url: `https://checkout.stripe.test/${id}` };
    },
    async getSession(id) {
      return sessions.get(id);
    },
    pay(id, changes = {}) {
      const s = { ...sessions.get(id)!, paid: true, ...changes };
      sessions.set(id, s);
      return s;
    },
  };
  return gateway;
}

describe.each(repositories)("%s repository: buying credits", (_name, makeRepo) => {
  async function setup() {
    const repo = await makeRepo();
    const gateway = fakeGateway();
    return { repo, gateway, billing: createBilling({ repo, gateway }) };
  }

  it("lists the packs with their price per credit and the saving against the first pack", async () => {
    const { billing } = await setup();
    expect(billing.packs()).toEqual([
      { id: "start", credits: 1_000, priceChf: 10, rappenPerCredit: 1, saving: 0 },
      { id: "plus", credits: 3_000, priceChf: 27, rappenPerCredit: 0.9, saving: 10 },
      { id: "pro", credits: 7_500, priceChf: 60, rappenPerCredit: 0.8, saving: 20 },
      { id: "studio", credits: 20_000, priceChf: 140, rappenPerCredit: 0.7, saving: 30 },
    ]);
  });

  it("starts a checkout for a pack at its server-side price", async () => {
    const { billing, gateway } = await setup();
    const res = await billing.checkout(ACC, "plus", URLS, "user@example.com");

    expect(res).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_test_1" });
    expect(gateway.created[0]).toMatchObject({ accountId: ACC, email: "user@example.com", pack: { id: "plus", credits: 3_000, priceChf: 27 } });
  });

  it("refuses a pack that does not exist", async () => {
    const { billing } = await setup();
    expect(await billing.checkout(ACC, "mega", URLS)).toEqual({ ok: false, error: "unknown_pack" });
  });

  it("sells nothing without a payment provider", async () => {
    const repo = await makeRepo();
    const billing = createBilling({ repo });
    expect(billing.enabled).toBe(false);
    expect(await billing.checkout(ACC, "start", URLS)).toEqual({ ok: false, error: "payments_unavailable" });
  });

  it("grants the pack's credits once, however often the payment is reported (webhook and return page)", async () => {
    const { billing, gateway, repo } = await setup();
    await billing.checkout(ACC, "start", URLS);
    const paid = gateway.pay("cs_test_1");

    expect(await billing.fulfil(paid)).toEqual({ ok: true, credits: 1_000 });
    expect(await billing.confirm(ACC, "cs_test_1")).toEqual({ ok: true, credits: 1_000 });
    await billing.fulfil(paid);

    expect(await repo.balance(ACC)).toBe(1_000);
    const statement = await createCredits(repo).statement(ACC);
    expect(statement.entries).toMatchObject([{ kind: "grant", source: "purchase", credits: 1_000 }]);
  });

  it("takes back the credits of a refunded purchase, each partial refund once", async () => {
    const { billing, gateway, repo } = await setup();
    await billing.checkout(ACC, "plus", URLS);
    await billing.fulfil(gateway.pay("cs_test_1", { paymentIntent: "pi_1" }));

    expect(await billing.reverse({ kind: "refund", paymentIntent: "pi_1", amountRefunded: 900 })).toEqual({ ok: true, taken: 1_000, returned: 0, owed: 0 });
    expect(await billing.reverse({ kind: "refund", paymentIntent: "pi_1", amountRefunded: 900 })).toEqual({ ok: true, taken: 0, returned: 0, owed: 0 });
    expect(await repo.balance(ACC)).toBe(2_000);
    expect(await billing.reverse({ kind: "refund", paymentIntent: "pi_1", amountRefunded: 2_700 })).toEqual({ ok: true, taken: 2_000, returned: 0, owed: 0 });
    expect(await repo.balance(ACC)).toBe(0);
  });

  it("takes back no more than the purchase when two refunds of one payment arrive at the same time", async () => {
    const { billing, gateway, repo } = await setup();
    await billing.checkout(ACC, "plus", URLS);
    await billing.fulfil(gateway.pay("cs_test_1", { paymentIntent: "pi_1" }));

    // Stripe sends its webhooks side by side; amount_refunded is the running total of the payment.
    const [a, b] = await Promise.all([
      billing.reverse({ kind: "refund", paymentIntent: "pi_1", amountRefunded: 900 }),
      billing.reverse({ kind: "refund", paymentIntent: "pi_1", amountRefunded: 2_700 }),
    ]);
    expect((a as { taken: number }).taken + (b as { taken: number }).taken).toBe(3_000);
    expect(await repo.balance(ACC)).toBe(0);
    expect(await repo.owed(ACC)).toBe(0);
  });

  it("keeps what was already spent as owed, and the next purchase pays it first", async () => {
    const { billing, gateway, repo } = await setup();
    await billing.checkout(ACC, "start", URLS);
    await billing.fulfil(gateway.pay("cs_test_1", { paymentIntent: "pi_1" }));
    const job = { id: "10000000-0000-4000-8000-0000000000e1", accountId: ACC, jobType: "t", model: "T", credits: 900, params: {}, createdAt: Date.now() };
    await repo.create(job);
    await repo.succeed(job.id, []);

    expect(await billing.reverse({ kind: "refund", paymentIntent: "pi_1", amountRefunded: 1_000 })).toEqual({ ok: true, taken: 1_000, returned: 0, owed: 900 });
    await billing.checkout(ACC, "plus", URLS);
    await billing.fulfil(gateway.pay("cs_test_2", { paymentIntent: "pi_2" }));

    expect([await repo.balance(ACC), await repo.owed(ACC)]).toEqual([2_100, 0]);
  });

  it("takes a disputed purchase back at once and gives it back when the dispute is won", async () => {
    const { billing, gateway, repo } = await setup();
    await billing.checkout(ACC, "start", URLS);
    await billing.fulfil(gateway.pay("cs_test_1", { paymentIntent: "pi_1" }));
    const dispute = { kind: "dispute", paymentIntent: "pi_1", disputeId: "dp_1", amount: 1_000 } as const;

    expect(await billing.reverse({ ...dispute, status: "open" })).toEqual({ ok: true, taken: 1_000, returned: 0, owed: 0 });
    expect(await billing.reverse({ ...dispute, status: "open" })).toEqual({ ok: true, taken: 0, returned: 0, owed: 0 });
    expect(await repo.balance(ACC)).toBe(0);
    expect(await billing.reverse({ ...dispute, status: "won" })).toEqual({ ok: true, taken: 0, returned: 1_000, owed: 0 });
    expect(await repo.balance(ACC)).toBe(1_000);
    expect(await billing.reverse({ ...dispute, status: "won" })).toEqual({ ok: true, taken: 0, returned: 0, owed: 0 });
  });

  it("ignores a refund or dispute of a payment it never credited", async () => {
    const { billing } = await setup();
    expect(await billing.reverse({ kind: "refund", paymentIntent: "pi_unknown", amountRefunded: 1_000 })).toEqual({ ok: false, error: "unknown_payment" });
  });

  it("grants nothing while the session is not paid", async () => {
    const { billing, repo } = await setup();
    await billing.checkout(ACC, "start", URLS);

    expect(await billing.confirm(ACC, "cs_test_1")).toEqual({ ok: false, error: "not_paid" });
    expect(await repo.balance(ACC)).toBe(0);
  });

  it("never credits a purchase to another account", async () => {
    const { billing, gateway, repo } = await setup();
    await billing.checkout(ACC, "start", URLS);
    gateway.pay("cs_test_1");

    expect(await billing.confirm(OTHER, "cs_test_1")).toEqual({ ok: false, error: "not_found" });
    expect(await repo.balance(OTHER)).toBe(0);
  });

  it("grants nothing when the paid amount differs from what the session promised", async () => {
    const { billing, gateway, repo } = await setup();
    await billing.checkout(ACC, "studio", URLS);
    const tampered = gateway.pay("cs_test_1", { amountTotal: 100 });

    expect(await billing.fulfil(tampered)).toEqual({ ok: false, error: "amount_mismatch" });
    expect(await repo.balance(ACC)).toBe(0);
  });
});

const DAY = 86_400_000;
const START = Date.parse("2026-10-15T10:00:00Z");
const MONTH_END = START + 31 * DAY;

/** A gateway for plans: records checkouts and portal sessions, answers the return page with a scripted session. */
function fakePlanGateway() {
  const base = fakeGateway();
  const planCreated: PlanCheckoutRequest[] = [];
  const portals: { customerId: string; returnUrl: string }[] = [];
  const planSessions = new Map<string, PlanSession>();
  const gateway: PaymentGateway & { planCreated: typeof planCreated; portals: typeof portals; planSessions: typeof planSessions } = {
    ...base,
    planCreated, portals, planSessions,
    async createPlanCheckout(req) {
      planCreated.push(req);
      return { id: `cs_sub_${planCreated.length}`, url: `https://checkout.stripe.test/cs_sub_${planCreated.length}` };
    },
    async createPortal(customerId, returnUrl) {
      portals.push({ customerId, returnUrl });
      return { url: `https://billing.stripe.test/p/${customerId}` };
    },
    async getPlanSession(id) {
      return planSessions.get(id);
    },
  };
  return gateway;
}

const invoice = (changes: Partial<PlanInvoice> = {}): PlanInvoice => ({
  id: "in_1", subscriptionId: "sub_1", accountId: ACC, reason: "create", currency: "chf", amountPaid: 1_800, paid: true,
  planId: "monat-2000", periodEnd: MONTH_END, ...changes,
});

const state = (changes: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  id: "sub_1", accountId: ACC, customerId: "cus_1", planId: "monat-2000", status: "active", currentPeriodEnd: MONTH_END,
  cancelAtPeriodEnd: false, eventAt: START, ...changes,
});

describe.each(repositories)("%s repository: monthly plans (Abo)", (_name, makeRepo) => {
  async function setup() {
    const clock = { now: START };
    const repo = await makeRepo({ now: () => clock.now });
    const gateway = fakePlanGateway();
    const subscriptions = createMemorySubscriptions();
    return { repo, gateway, clock, subscriptions, billing: createBilling({ repo, gateway, subscriptions }) };
  }

  it("lists the plans with their price per credit", async () => {
    const { billing } = await setup();
    expect(billing.plans()).toEqual([
      { id: "monat-2000", credits: 2_000, priceChf: 18, rappenPerCredit: 0.9 },
      { id: "monat-5000", credits: 5_000, priceChf: 42, rappenPerCredit: 0.84 },
      { id: "monat-12000", credits: 12_000, priceChf: 90, rappenPerCredit: 0.75 },
      { id: "monat-25000", credits: 25_000, priceChf: 175, rappenPerCredit: 0.7 },
    ]);
  });

  it("starts a plan checkout at its server-side price and reuses the account's customer", async () => {
    const { billing, gateway, subscriptions } = await setup();

    expect(await billing.subscribe(ACC, "monat-5000", URLS, "user@example.com")).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_sub_1" });
    expect(gateway.planCreated[0]).toMatchObject({ accountId: ACC, email: "user@example.com", plan: { id: "monat-5000", credits: 5_000, priceChf: 42 } });
    expect(gateway.planCreated[0]).not.toHaveProperty("customerId");

    await subscriptions.upsert(state({ status: "canceled" }));
    await billing.subscribe(ACC, "monat-2000", URLS);
    expect(gateway.planCreated[1]).toMatchObject({ customerId: "cus_1", plan: { id: "monat-2000" } });
  });

  it("refuses a second plan while one runs, an unknown plan, and plans without a payment provider", async () => {
    const { billing, subscriptions, repo } = await setup();
    await subscriptions.upsert(state({ status: "past_due" }));

    expect(await billing.subscribe(ACC, "monat-25000", URLS)).toEqual({ ok: false, error: "plan_exists" });
    expect(await billing.subscribe(OTHER, "monat-999", URLS)).toEqual({ ok: false, error: "unknown_plan" });
    expect(await createBilling({ repo }).subscribe(OTHER, "monat-2000", URLS)).toEqual({ ok: false, error: "payments_unavailable" });
  });

  it("grants a month's credits from its paid invoice once, and they lapse at the end of the month", async () => {
    const { billing, repo, clock } = await setup();

    expect(await billing.fulfilPlanInvoice(invoice())).toEqual({ ok: true, credits: 2_000 });
    expect(await billing.fulfilPlanInvoice(invoice())).toEqual({ ok: true, credits: 2_000 });
    expect(await repo.balance(ACC)).toBe(2_000);
    expect(await repo.grants(ACC)).toMatchObject([{ ref: "sub:in_1", credits: 2_000, expiresAt: MONTH_END }]);

    clock.now = MONTH_END;
    expect(await repo.balance(ACC)).toBe(0);
  });

  it("grants the next month's credits on renewal", async () => {
    const { billing, repo, clock } = await setup();
    await billing.fulfilPlanInvoice(invoice());

    clock.now = MONTH_END;
    expect(await billing.fulfilPlanInvoice(invoice({ id: "in_2", reason: "cycle", periodEnd: MONTH_END + 30 * DAY }))).toEqual({ ok: true, credits: 2_000 });
    expect(await repo.balance(ACC)).toBe(2_000);
  });

  it("refuses unpaid, foreign-currency and unknown-plan invoices", async () => {
    const { billing, repo } = await setup();

    expect(await billing.fulfilPlanInvoice(invoice({ currency: "eur" }))).toEqual({ ok: false, error: "amount_mismatch" });
    expect(await billing.fulfilPlanInvoice(invoice({ paid: false }))).toEqual({ ok: false, error: "not_paid" });
    expect(await billing.fulfilPlanInvoice(invoice({ planId: undefined }))).toEqual({ ok: false, error: "unknown_plan" });
    expect(await repo.balance(ACC)).toBe(0);
  });

  it("grants a month paid partly from a Stripe balance at the plan's price per credit, and never more than the plan", async () => {
    const { billing, repo } = await setup();

    expect(await billing.fulfilPlanInvoice(invoice({ reason: "cycle", amountPaid: 900 }))).toEqual({ ok: true, credits: 1_000 });
    expect(await billing.fulfilPlanInvoice(invoice({ id: "in_2", reason: "cycle", amountPaid: 5_000 }))).toEqual({ ok: true, credits: 2_000 });
    expect(await repo.balance(ACC)).toBe(3_000);
  });

  it("grants an upgrade in the middle of the month at the new plan's price per credit, never cheaper", async () => {
    const { billing, repo } = await setup();
    await billing.fulfilPlanInvoice(invoice());

    // Stripe charges what is left of the month on the bigger plan, minus what is left on the old one.
    const res = await billing.fulfilPlanInvoice(invoice({ id: "in_up", reason: "update", planId: "monat-25000", amountPaid: 7_850 }));

    expect(res).toEqual({ ok: true, credits: 11_214 });
    expect(78.5 / 11_214).toBeGreaterThanOrEqual(175 / 25_000);
    expect(await repo.balance(ACC)).toBe(13_214);
    expect(await billing.fulfilPlanInvoice(invoice({ id: "in_zero", reason: "update", planId: "monat-25000", amountPaid: 0 }))).toEqual({ ok: true, credits: 0 });
  });

  it("keeps the newest plan state, whatever order the provider's events arrive in", async () => {
    const { billing } = await setup();

    await billing.syncSubscription(state({ status: "active", cancelAtPeriodEnd: true, eventAt: START + 2_000 }));
    await billing.syncSubscription(state({ status: "active", cancelAtPeriodEnd: false, eventAt: START + 1_000 }));

    expect(await billing.subscription(ACC)).toEqual({ planId: "monat-2000", status: "active", currentPeriodEnd: MONTH_END, cancelAtPeriodEnd: true });
    expect(await billing.subscription(OTHER)).toBeNull();
  });

  it("opens the customer portal with the account's own customer", async () => {
    const { billing, gateway, subscriptions } = await setup();

    expect(await billing.portal(ACC, "https://studio.test/credits")).toEqual({ ok: false, error: "no_subscription" });
    await subscriptions.upsert(state());
    expect(await billing.portal(ACC, "https://studio.test/credits")).toEqual({ ok: true, url: "https://billing.stripe.test/p/cus_1" });
    expect(gateway.portals).toEqual([{ customerId: "cus_1", returnUrl: "https://studio.test/credits" }]);
  });

  it("takes a refunded month from that month's credits first, not from bought packs", async () => {
    const { billing, repo } = await setup();
    await repo.grant(ACC, 1_000, "stripe:cs_pack");
    await billing.fulfilPlanInvoice(invoice({ paymentIntent: "pi_sub" }));

    expect(await billing.reverse({ kind: "refund", paymentIntent: "pi_sub", amountRefunded: 1_800 })).toEqual({ ok: true, taken: 2_000, returned: 0, owed: 0 });
    expect(await repo.balance(ACC)).toBe(1_000);
  });

  it("books the plan from the return page too, for the account that paid only", async () => {
    const { billing, gateway, repo } = await setup();
    gateway.planSessions.set("cs_sub_1", { accountId: ACC, invoice: invoice(), subscription: state() });

    expect(await billing.confirmPlan(OTHER, "cs_sub_1")).toEqual({ ok: false, error: "not_found" });
    expect(await billing.confirmPlan(ACC, "cs_sub_1")).toEqual({ ok: true, credits: 2_000 });
    expect(await billing.subscription(ACC)).toMatchObject({ planId: "monat-2000", status: "active" });
    expect(await repo.balance(ACC)).toBe(2_000);
  });

  it("credits nothing from the return page when the invoice names another account than the session", async () => {
    const { billing, gateway, repo } = await setup();
    gateway.planSessions.set("cs_sub_2", { accountId: ACC, invoice: invoice({ id: "in_x", accountId: OTHER }) });

    expect(await billing.confirmPlan(ACC, "cs_sub_2")).toEqual({ ok: false, error: "not_found" });
    expect([await repo.balance(ACC), await repo.balance(OTHER)]).toEqual([0, 0]);
    expect(await billing.subscription(ACC)).toBeNull();
  });
});

describe("Stripe webhook signature", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = Date.parse("2026-10-13T18:00:00Z");
  const sign = (t: number, body = payload, key = secret) => `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest("hex")}`;

  it("accepts an event signed with our secret within five minutes", () => {
    expect(verifyStripeSignature(payload, sign(now / 1000 - 60), secret, now)).toBe(true);
  });

  it("rejects a forged, altered or replayed event", () => {
    expect(verifyStripeSignature(payload, sign(now / 1000, payload, "whsec_other"), secret, now)).toBe(false);
    expect(verifyStripeSignature(payload.replace("evt_1", "evt_2"), sign(now / 1000), secret, now)).toBe(false);
    expect(verifyStripeSignature(payload, sign(now / 1000 - 301), secret, now)).toBe(false);
    expect(verifyStripeSignature(payload, "garbage", secret, now)).toBe(false);
  });
});
