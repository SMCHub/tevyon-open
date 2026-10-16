import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, PLANS } from "../core/pricing";
import { createStripeGateway, toPaidSession, toPlanInvoice, toReversal, toSubscriptionState } from "./stripe";

const ACC = "00000000-0000-4000-8000-0000000000b1";

function recordingFetch(answer: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Stripe gateway", () => {
  it("opens a CHF checkout for the pack at the server's price, without fixing the payment methods", async () => {
    const { f, calls } = recordingFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const gateway = createStripeGateway({ secretKey: "rk_test_x", fetch: f });

    const session = await gateway.createCheckout({
      accountId: ACC, email: "user@example.com", pack: CREDIT_PACKS[1]!, successUrl: "https://s/ok?c={CHECKOUT_SESSION_ID}", cancelUrl: "https://s/cancel",
    });

    expect(session).toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(body.get("mode")).toBe("payment");
    expect(body.get("line_items[0][price_data][currency]")).toBe("chf");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2700");
    expect(body.get("client_reference_id")).toBe(ACC);
    expect(body.get("metadata[credits]")).toBe("3000");
    expect(body.get("metadata[amount]")).toBe("2700");
    expect([...body.keys()].some((k) => k.startsWith("payment_method_types"))).toBe(false);
    // Terms, "right of withdrawal": the buyer asks for immediate performance in a required checkbox, and the receipt repeats it.
    expect(body.get("consent_collection[terms_of_service]")).toBe("required");
    expect(body.get("custom_text[terms_of_service_acceptance][message]")).toMatch(/right of withdrawal \(EU\) ends/);
    expect(body.get("payment_intent_data[receipt_email]")).toBe("user@example.com");
    expect((calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("names Tevyon on a shared Stripe account: marked as ours, Tevyon at the top, on the card statement and in the linked terms", async () => {
    const { f, calls } = recordingFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const gateway = createStripeGateway({ secretKey: "rk_test_x", fetch: f });

    await gateway.createCheckout({ accountId: ACC, pack: CREDIT_PACKS[0]!, successUrl: "https://app.example/credits?c=1", cancelUrl: "https://app.example/credits" });

    const body = new URLSearchParams(String(calls[0]!.init.body));
    // The account also takes payments of other businesses: only what carries this mark is Tevyon's.
    expect(body.get("metadata[app]")).toBe("tevyon");
    expect(body.get("payment_intent_data[metadata][app]")).toBe("tevyon");
    expect(body.get("branding_settings[display_name]")).toBe("Tevyon");
    // Rectangles, never pills.
    expect(body.get("branding_settings[border_style]")).toBe("rounded");
    // The account's prefix plus this suffix: "TEVYON* CREDITS" on the card statement.
    expect(body.get("payment_intent_data[statement_descriptor_suffix]")).toBe("CREDITS");
    expect(body.get("custom_text[terms_of_service_acceptance][message]")).toContain("[Terms of Service](https://tachyon-landing.vercel.app/agb)");
    expect(body.get("custom_text[terms_of_service_acceptance][message]")).toContain("[Privacy Policy](https://tachyon-landing.vercel.app/datenschutz)");
    // The receipt keeps plain text.
    expect(body.get("payment_intent_data[description]")).not.toContain("](");
  });

  it("reads a session as paid only when Stripe says paid, with the account and promise we set", () => {
    const base = { id: "cs_1", client_reference_id: ACC, metadata: { app: "tevyon", accountId: ACC, credits: "1000", amount: "1000" }, amount_total: 1000, currency: "chf" };
    expect(toPaidSession({ ...base, payment_status: "paid" })).toEqual({ id: "cs_1", accountId: ACC, credits: 1000, amount: 1000, amountTotal: 1000, currency: "chf", paid: true });
    expect(toPaidSession({ ...base, payment_status: "unpaid" })?.paid).toBe(false);
    expect(toPaidSession({ ...base, metadata: { ...base.metadata, accountId: "someone-else" } })).toBeUndefined();
  });

  it("leaves sessions, invoices and subscriptions of other businesses on the same Stripe account alone", async () => {
    // Another shop on the account may name its customer the same way; without Tevyon's mark nothing is ours.
    const foreignMeta = { accountId: ACC, credits: "1000", amount: "1000", planId: "monat-2000" };
    expect(toPaidSession({ id: "cs_1", client_reference_id: ACC, metadata: foreignMeta, amount_total: 1000, currency: "chf", payment_status: "paid" })).toBeUndefined();
    const sub = { id: "sub_1", status: "active", metadata: foreignMeta, items: { data: [{ price: { id: "price_b", lookup_key: "monat-5000" } }] } };
    expect(toSubscriptionState(sub, 5, new Map())).toBeUndefined();
    const invoice = { id: "in_1", status: "paid", parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: foreignMeta } } };
    expect(toPlanInvoice(invoice, new Map())).toBeUndefined();

    const { f, calls } = recordingFetch({ data: [] });
    expect(await createStripeGateway({ secretKey: "rk_test_x", fetch: f }).readPlanInvoice(invoice)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("keeps Stripe's error text on the server", async () => {
    const { f } = recordingFetch({ error: { message: "No such price: secret detail" } }, 400);
    const gateway = createStripeGateway({ secretKey: "rk_test_x", fetch: f });
    await expect(gateway.getSession("cs_x")).rejects.toThrow(/Stripe 400/);
  });

  it("reads the payment behind a paid session, so a later refund finds the purchase", () => {
    const s = toPaidSession({ id: "cs_1", client_reference_id: ACC, metadata: { app: "tevyon", accountId: ACC, credits: "1000", amount: "1000" }, amount_total: 1000, currency: "chf", payment_status: "paid", payment_intent: "pi_9" });
    expect(s?.paymentIntent).toBe("pi_9");
  });

  it("opens a plan checkout with the plan's recurring price found by lookup key, its metadata on the subscription, and the account's customer", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const answer = url.includes("/prices?")
        ? { data: [...PLANS.map((p) => ({ id: p.id === "monat-5000" ? "price_b" : `price_${p.id}`, lookup_key: p.id, active: true })), { id: "price_x", lookup_key: "other", active: true }] }
        : { id: "cs_sub_1", url: "https://checkout.stripe.com/c/pay/cs_sub_1" };
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const gateway = createStripeGateway({ secretKey: "rk_test_x", fetch: f });
    const plan = PLANS.find((p) => p.id === "monat-5000")!;

    await gateway.createPlanCheckout!({ accountId: ACC, customerId: "cus_1", plan, successUrl: "https://s/ok", cancelUrl: "https://s/cancel" });
    await gateway.createPlanCheckout!({ accountId: ACC, email: "user@example.com", plan, successUrl: "https://s/ok", cancelUrl: "https://s/cancel" });

    expect(calls.filter((c) => c.url.includes("/prices?"))).toHaveLength(1);
    expect(decodeURIComponent(calls[0]!.url)).toContain("lookup_keys[]=monat-5000");
    const body = new URLSearchParams(String(calls[1]!.init.body));
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][price]")).toBe("price_b");
    expect(body.get("customer")).toBe("cus_1");
    expect(body.get("customer_email")).toBeNull();
    expect(body.get("subscription_data[metadata][accountId]")).toBe(ACC);
    expect(body.get("subscription_data[metadata][planId]")).toBe("monat-5000");
    // Every invoice of the plan carries the mark, so its months are recognised as Tevyon's.
    expect(body.get("subscription_data[metadata][app]")).toBe("tevyon");
    expect(body.get("branding_settings[display_name]")).toBe("Tevyon");
    expect(body.get("custom_text[terms_of_service_acceptance][message]")).toContain("[Terms of Service](https://tachyon-landing.vercel.app/agb)");
    expect(body.get("custom_text[terms_of_service_acceptance][message]")).toMatch(/renews every month/);
    expect([...body.keys()].some((k) => k.startsWith("payment_method_types"))).toBe(false);
    expect(new URLSearchParams(String(calls[2]!.init.body)).get("customer_email")).toBe("user@example.com");
  });

  it("refuses a plan checkout while the plan has no price at Stripe, and finds it once the setup script created it", async () => {
    let created = false;
    const lookups: string[] = [];
    const f = (async (url: string) => {
      if (url.includes("/prices?")) lookups.push(url);
      const answer = url.includes("/prices?")
        ? { data: created ? PLANS.map((p) => ({ id: `price_${p.id}`, lookup_key: p.id, active: true })) : [] }
        : { id: "cs_sub_1", url: "https://checkout.stripe.com/c/pay/cs_sub_1" };
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const gateway = createStripeGateway({ secretKey: "rk_test_x", fetch: f });
    const req = { accountId: ACC, plan: PLANS[0]!, successUrl: "https://s/ok", cancelUrl: "https://s/c" };

    await expect(gateway.createPlanCheckout!(req)).rejects.toThrow(/lookup_key monat-2000/);
    created = true;
    await expect(gateway.createPlanCheckout!(req)).resolves.toEqual({ id: "cs_sub_1", url: "https://checkout.stripe.com/c/pay/cs_sub_1" });
    await gateway.createPlanCheckout!(req);
    expect(lookups).toHaveLength(2);
  });

  it("reads a subscription state, also when the portal cancels with cancel_at", () => {
    const prices = new Map([["price_b", "monat-5000" as const]]);
    const sub = {
      id: "sub_1", status: "active", customer: { id: "cus_1" }, cancel_at_period_end: false, cancel_at: 1_800_000_000,
      metadata: { app: "tevyon", accountId: ACC }, items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_b", lookup_key: null } }] },
    };
    expect(toSubscriptionState(sub, 5, prices)).toEqual({
      id: "sub_1", accountId: ACC, customerId: "cus_1", planId: "monat-5000", status: "active", currentPeriodEnd: 1_800_000_000_000, cancelAtPeriodEnd: true, eventAt: 5,
    });
    expect(toSubscriptionState({ ...sub, metadata: {} }, 5, prices)).toBeUndefined();
    expect(toSubscriptionState({ ...sub, status: "made_up" }, 5, prices)).toBeUndefined();
  });

  it("reads refunds and disputes by their payment, with the amounts Stripe reports", () => {
    const charge = { object: "charge", payment_intent: "pi_1", amount: 2700, amount_refunded: 900 };
    const dispute = { object: "dispute", id: "dp_1", payment_intent: "pi_1", amount: 2700, status: "needs_response" };
    expect(toReversal({ type: "charge.refunded", data: { object: charge } })).toEqual({ kind: "refund", paymentIntent: "pi_1", amountRefunded: 900 });
    expect(toReversal({ type: "charge.dispute.created", data: { object: dispute } })).toEqual({ kind: "dispute", paymentIntent: "pi_1", disputeId: "dp_1", amount: 2700, status: "open" });
    expect(toReversal({ type: "charge.dispute.closed", data: { object: { ...dispute, status: "won" } } })).toMatchObject({ status: "won" });
    expect(toReversal({ type: "charge.dispute.closed", data: { object: { ...dispute, status: "warning_closed" } } })).toMatchObject({ status: "won" });
    expect(toReversal({ type: "charge.dispute.closed", data: { object: { ...dispute, status: "lost" } } })).toMatchObject({ status: "lost" });
    expect(toReversal({ type: "checkout.session.completed", data: { object: {} } })).toBeUndefined();
    expect(toReversal({ type: "charge.refunded", data: { object: { ...charge, payment_intent: null } } })).toBeUndefined();
  });
});

