import { verifyStripeSignature } from "@/core/billing";
import { billing, stripeGateway } from "@/server/billing";
import { toPaidSession, toReversal, type StripeInvoice, type StripeSubscription } from "@/server/stripe";

/** Events that may mean «paid»: card payments complete at once, TWINT and other async methods report success later. */
const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
/** Events that take credits back (refund, dispute) or give them back (dispute won). */
const REVERSAL_EVENTS = new Set(["charge.refunded", "charge.dispute.created", "charge.dispute.closed"]);
/** A plan's state: created, switched in the portal, cancelled, past due, ended. */
const PLAN_EVENTS = new Set(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);

type StripeEvent = { type?: string; created?: number; data?: { object?: Record<string, unknown> } };

/**
 * Stripe webhook. Every event is verified against STRIPE_WEBHOOK_SECRET before anything happens. A paid session is
 * credited once (same grant ref as the return page); a paid plan invoice gives that month's credits; subscription events
 * keep the plan's state; a refund or dispute takes the credits back, a won dispute gives them back. Errors on our side
 * answer 500, so Stripe retries.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature") ?? "", secret)) {
    return new Response("Invalid signature", { status: 400 });
  }
  const event = JSON.parse(payload) as StripeEvent;
  const type = event.type ?? "";
  const object = event.data?.object ?? {};

  if (type === "invoice.paid") {
    const gateway = stripeGateway();
    if (!gateway) return new Response("Payments not configured", { status: 503 });
    const invoice = await gateway.readPlanInvoice(object as StripeInvoice);
    if (!invoice) return Response.json({ received: true });
    const res = await (await billing()).fulfilPlanInvoice(invoice);
    if (!res.ok) {
      console.warn(`[billing] invoice ${invoice.id}: ${res.error}`);
      // A price we do not know yet may be known after a restart (new price, empty cache): let Stripe try again.
      if (res.error === "unknown_plan") return new Response("Unknown plan", { status: 500 });
    }
    return Response.json({ received: true });
  }

  if (PLAN_EVENTS.has(type)) {
    const gateway = stripeGateway();
    if (!gateway) return new Response("Payments not configured", { status: 503 });
    const state = await gateway.readSubscription(object as StripeSubscription, event.created ? event.created * 1000 : Date.now());
    if (!state) {
      console.warn(`[billing] ${type} without our account metadata or a known plan`);
      return Response.json({ received: true });
    }
    await (await billing()).syncSubscription(state);
    return Response.json({ received: true });
  }

  if (REVERSAL_EVENTS.has(type)) {
    const reversal = toReversal(event);
    if (!reversal) return Response.json({ received: true });
    const res = await (await billing()).reverse(reversal);
    // Stripe also charges CHF 20 per dispute; that is money, not credits, and shows in the Stripe dashboard.
    if (!res.ok) console.warn(`[billing] ${type} for an unknown payment`);
    else console.warn(`[billing] ${type}: ${res.taken} credits taken back, ${res.returned} given back, ${res.owed} owed`);
    return Response.json({ received: true });
  }

  // A plan's checkout credits nothing by itself: its first month comes with invoice.paid.
  if (!PAID_EVENTS.has(type) || object.mode === "subscription") return Response.json({ received: true });

  const session = toPaidSession(object as Parameters<typeof toPaidSession>[0]);
  if (!session) {
    console.warn("[billing] webhook session without our account metadata");
    return Response.json({ received: true });
  }
  const res = await (await billing()).fulfil(session);
  if (!res.ok && res.error !== "not_paid") console.warn(`[billing] webhook ${session.id}: ${res.error}`);
  return Response.json({ received: true });
}
