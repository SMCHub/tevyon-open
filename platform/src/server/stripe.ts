import type { PaidSession, PaymentGateway, PaymentReversal, PlanInvoice, PlanSession } from "@/core/billing";
import { PLANS, type PlanId } from "@/core/pricing";
import { isPlanId, type SubscriptionRecord, type SubscriptionStatus } from "@/core/subscriptions";

const API = "https://api.stripe.com/v1";
/** Latest API version at the time of writing (stripe-best-practices, 13.10.2026). */
const STRIPE_VERSION = "2026-05-27.dahlia";

type StripeSession = {
  id: string;
  url?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string;
  payment_intent?: string | { id: string } | null;
};

/**
 * Consent at checkout (AGB «Widerrufsrecht»): EU consumers ask for immediate performance and confirm that their right of
 * withdrawal ends with the first job started with the bought credits. Stripe shows it as a required checkbox; the receipt
 * repeats it (durable medium). Needs a terms-of-service URL in the Stripe dashboard (public business details).
 */
const WAIVER =
  "Ich verlange, dass Tevyon sofort leistet. Mir ist bewusst, dass mein Widerrufsrecht (EU) erlischt, sobald ich den ersten Job mit den gekauften Credits starte.";

/** The same for a plan (AGB «Abos» and «Widerrufsrecht»): the right ends with the first job of the first month; later months are renewals. */
const PLAN_WAIVER =
  "Ich verlange, dass Tevyon sofort leistet. Mir ist bewusst, dass mein Widerrufsrecht (EU) erlischt, sobald ich den ersten Job mit den Credits des Abos starte. Das Abo verlängert sich jeden Monat, bis ich es im Konto kündige.";

const TERMS = "Es gelten die AGB von Tevyon.";

/**
 * The checkbox links Tevyon's own terms: the Stripe account (formerly App01, Tevyon since 16.10.2026) also bills other
 * services, so its terms URL in the dashboard is only the one Stripe requires, never what the buyer reads.
 */
function linkedTerms(): string {
  const legal = (process.env.NEXT_PUBLIC_LANDING_URL ?? "https://tachyon-landing.vercel.app").replace(/\/$/, "");
  return `Es gelten die [AGB](${legal}/agb) und die [Datenschutzerklärung](${legal}/datenschutz) von Tevyon.`;
}

/**
 * Tevyon's mark in the metadata of every session, payment and subscription it opens. The account also takes payments
 * of other businesses (payment links, other apps), and the webhook gets their events too: only marked objects are ours.
 */
const MARK = { app: "tevyon" } as const;
const isOurs = (metadata?: Record<string, string> | null) => metadata?.app === MARK.app;

/**
 * Tevyon's look on the checkout page: monochrome, rectangles instead of pills. Logo and icon come from the account's
 * branding (Stripe dashboard); the name stays Tevyon even if the account's public name changes.
 */
const BRANDING = {
  display_name: "Tevyon",
  border_style: "rounded",
  font_family: "inter",
  button_color: "#0A0A0B",
  background_color: "#F5F5F2",
} as const;

/** Joined to the account's prefix on card statements: «TEVYON* CREDITS». */
const STATEMENT_SUFFIX = "CREDITS";

type StripeLine = {
  amount?: number;
  period?: { start?: number; end?: number } | null;
  pricing?: { price_details?: { price?: string | { id?: string } | null } | null } | null;
  parent?: { subscription_item_details?: { proration?: boolean } | null; invoice_item_details?: { proration?: boolean } | null } | null;
};

/** The parts of a Stripe Invoice (API 2026-05-27.dahlia) that a plan month needs. */
export type StripeInvoice = {
  id?: string;
  status?: string | null;
  billing_reason?: string | null;
  currency?: string | null;
  amount_paid?: number | null;
  parent?: { type?: string; subscription_details?: { subscription?: string | { id?: string } | null; metadata?: Record<string, string> | null } | null } | null;
  lines?: { data?: StripeLine[] } | null;
  payments?: { data?: { status?: string; payment?: { payment_intent?: string | { id?: string } | null } | null }[] } | null;
};

/** The parts of a Stripe Subscription; the period end sits on the item since API 2025-03-31. */
export type StripeSubscription = {
  id?: string;
  status?: string;
  customer?: string | { id?: string } | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: { current_period_end?: number | null; price?: { id?: string; lookup_key?: string | null } | null }[] } | null;
};

const idOf = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : "";

const REASON: Record<string, PlanInvoice["reason"]> = { subscription_create: "create", subscription_cycle: "cycle", subscription_update: "update" };
const isProration = (l: StripeLine) => Boolean(l.parent?.subscription_item_details?.proration ?? l.parent?.invoice_item_details?.proration);

/**
 * A plan invoice as the billing core needs it, or undefined for anything that is not a subscription invoice. The plan
 * comes from the line that bills it: on an upgrade the new plan's proration (the positive line), otherwise the plan's
 * own line. The account comes from the subscription metadata the invoice keeps a snapshot of.
 */
export function toPlanInvoice(o: StripeInvoice, plansByPrice: ReadonlyMap<string, PlanId>, paymentIntent?: string): PlanInvoice | undefined {
  if (o.parent?.type !== "subscription_details" || !isOurs(o.parent.subscription_details?.metadata)) return undefined;
  const details = o.parent.subscription_details;
  const reason = REASON[o.billing_reason ?? ""] ?? "other";
  const lines = o.lines?.data ?? [];
  const line = reason === "update" ? lines.find((l) => isProration(l) && (l.amount ?? 0) > 0) : lines.find((l) => !isProration(l));
  const planId = plansByPrice.get(idOf(line?.pricing?.price_details?.price));
  const intent = paymentIntent ?? idOf(o.payments?.data?.find((p) => p.status === "paid")?.payment?.payment_intent);
  return {
    id: o.id ?? "", subscriptionId: idOf(details?.subscription), accountId: details?.metadata?.accountId ?? "", reason,
    currency: o.currency ?? "", amountPaid: o.amount_paid ?? 0, paid: o.status === "paid",
    ...(planId ? { planId } : {}), periodEnd: (line?.period?.end ?? 0) * 1000, ...(intent ? { paymentIntent: intent } : {}),
  };
}

const STATUSES: readonly SubscriptionStatus[] = ["active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"];

/** A subscription state for the store, or undefined without our account metadata or a known plan. */
export function toSubscriptionState(o: StripeSubscription, eventAt: number, plansByPrice: ReadonlyMap<string, PlanId>): SubscriptionRecord | undefined {
  const accountId = o.metadata?.accountId;
  const item = o.items?.data?.[0];
  const lookup = item?.price?.lookup_key;
  const planId = isPlanId(lookup) ? lookup : plansByPrice.get(item?.price?.id ?? "");
  const status = STATUSES.find((s) => s === o.status);
  if (!isOurs(o.metadata) || !accountId || !o.id || !planId || !status) return undefined;
  return {
    id: o.id, accountId, customerId: idOf(o.customer), planId, status,
    ...(item?.current_period_end ? { currentPeriodEnd: item.current_period_end * 1000 } : {}),
    // Cancelling in the portal ends the plan with its period; newer API versions set cancel_at for that.
    cancelAtPeriodEnd: Boolean(o.cancel_at_period_end) || typeof o.cancel_at === "number",
    eventAt,
  };
}

/** Stripe's form encoding for nested parameters: line_items[0][price_data][currency]=chf. */
function form(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") form(value as Record<string, unknown>, name, out);
    else out.append(name, String(value));
  }
  return out;
}

/** A checkout session as the billing core needs it. Account and promise come from what we set at creation. */
export function toPaidSession(s: StripeSession): PaidSession | undefined {
  const accountId = s.client_reference_id ?? "";
  if (!accountId || s.metadata?.accountId !== accountId || !isOurs(s.metadata)) return undefined;
  return {
    id: s.id,
    accountId,
    credits: Number(s.metadata?.credits),
    amount: Number(s.metadata?.amount),
    amountTotal: s.amount_total ?? -1,
    currency: s.currency ?? "",
    paid: s.payment_status === "paid",
    ...(intentId(s.payment_intent) ? { paymentIntent: intentId(s.payment_intent)! } : {}),
  };
}

const intentId = (v: unknown): string | undefined =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : undefined;

/**
 * A refund (charge.refunded, a Charge) or a dispute (charge.dispute.created / .closed, a Dispute) as the billing core
 * needs it. Both name the PaymentIntent, never our Checkout Session. An inquiry that closed without a dispute
 * (warning_closed) counts as won.
 */
export function toReversal(event: { type?: string; data?: { object?: Record<string, unknown> } }): PaymentReversal | undefined {
  const o = event.data?.object ?? {};
  const paymentIntent = intentId(o.payment_intent);
  if (!paymentIntent) return undefined;
  if (event.type === "charge.refunded" && typeof o.amount_refunded === "number") {
    return { kind: "refund", paymentIntent, amountRefunded: o.amount_refunded };
  }
  if ((event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") && typeof o.id === "string" && typeof o.amount === "number") {
    const status = event.type === "charge.dispute.created" ? "open" : o.status === "won" || o.status === "warning_closed" ? "won" : "lost";
    return { kind: "dispute", paymentIntent, disputeId: o.id, amount: o.amount, status };
  }
  return undefined;
}

export type StripeGateway = PaymentGateway & {
  /** A paid invoice event as a plan month (resolves the plan's price and the payment behind it). */
  readPlanInvoice(raw: StripeInvoice): Promise<PlanInvoice | undefined>;
  /** A customer.subscription.* event as a plan state. */
  readSubscription(raw: StripeSubscription, eventAt: number): Promise<SubscriptionRecord | undefined>;
};

/**
 * Stripe Checkout as payment gateway: one hosted page per pack purchase or plan, price in CHF set by the server,
 * payment methods chosen dynamically by Stripe (cards, TWINT, wallets): never pass payment_method_types.
 * Plans use the recurring Prices that scripts/stripe-setup.sh creates, found by lookup_key = plan id (never a price id
 * in code), and the customer portal configuration from STRIPE_PORTAL_CONFIGURATION.
 * Use a restricted key (rk_…): write on Checkout Sessions and Customer Portal sessions, read on Prices and Invoices.
 */
export function createStripeGateway(opts: { secretKey: string; portalConfiguration?: string; fetch?: typeof fetch }): StripeGateway {
  const doFetch = opts.fetch ?? fetch;
  const headers = { Authorization: `Bearer ${opts.secretKey}`, "Stripe-Version": STRIPE_VERSION };

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(`${API}${path}`, { ...init, headers: { ...headers, ...init.headers } });
    // Stripe's error text stays on the server; the caller only learns that the payment provider failed.
    if (!res.ok) throw new Error(`Stripe ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  const post = <T>(path: string, params: Record<string, unknown>) =>
    call<T>(path, { method: "POST", body: form(params), headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": crypto.randomUUID() } });

  /**
   * The plans' recurring Prices by lookup_key, once per process. A failed or empty lookup is asked again next time:
   * the server may have started before scripts/stripe-setup.sh created the prices.
   */
  let prices: Promise<{ byPrice: Map<string, PlanId>; byPlan: Map<PlanId, string> }> | undefined;
  function planPrices() {
    const pending = (prices ??= (async () => {
      const query = PLANS.map((p) => `lookup_keys[]=${encodeURIComponent(p.id)}`).join("&");
      const list = await call<{ data: { id: string; lookup_key?: string | null; active?: boolean }[] }>(`/prices?active=true&limit=20&${query}`);
      const byPrice = new Map<string, PlanId>();
      const byPlan = new Map<PlanId, string>();
      for (const p of list.data) {
        if (!isPlanId(p.lookup_key)) continue;
        byPrice.set(p.id, p.lookup_key);
        byPlan.set(p.lookup_key, p.id);
      }
      return { byPrice, byPlan };
    })());
    return pending.then(
      (found) => {
        if (found.byPlan.size < PLANS.length && prices === pending) prices = undefined;
        return found;
      },
      (e: unknown) => {
        if (prices === pending) prices = undefined;
        throw e;
      },
    );
  }

  /** The PaymentIntent behind a paid invoice (invoice payments are only included on request). */
  async function invoiceIntent(invoiceId: string): Promise<string | undefined> {
    try {
      const inv = await call<StripeInvoice>(`/invoices/${encodeURIComponent(invoiceId)}?expand[]=payments`);
      return idOf(inv.payments?.data?.find((p) => p.status === "paid")?.payment?.payment_intent) || undefined;
    } catch (e) {
      // Without it a refund of this month cannot find its credits; the month is still credited (logged for a manual fix).
      console.warn(`[billing] invoice ${invoiceId}: payment not readable`, e instanceof Error ? e.message.slice(0, 120) : e);
      return undefined;
    }
  }

  return {
    async createPlanCheckout(req) {
      const price = (await planPrices()).byPlan.get(req.plan.id);
      if (!price) throw new Error(`No Stripe price with lookup_key ${req.plan.id} (run scripts/stripe-setup.sh)`);
      const meta = { ...MARK, accountId: req.accountId, planId: req.plan.id };
      const s = await post<StripeSession>("/checkout/sessions", {
        mode: "subscription",
        client_reference_id: req.accountId,
        // One Stripe customer per account: the portal and every later plan use it.
        ...(req.customerId ? { customer: req.customerId } : { customer_email: req.email }),
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        locale: "auto",
        line_items: { 0: { price, quantity: 1 } },
        metadata: meta,
        // Every invoice keeps a snapshot of this, so a paid month names its account without another call.
        subscription_data: { metadata: meta, description: `Tevyon Abo: ${req.plan.credits.toLocaleString("de-CH")} Credits im Monat` },
        consent_collection: { terms_of_service: "required" },
        custom_text: { terms_of_service_acceptance: { message: `${PLAN_WAIVER} ${linkedTerms()}` } },
        branding_settings: BRANDING,
      });
      if (!s.url) throw new Error("Stripe returned no checkout URL");
      return { id: s.id, url: s.url };
    },

    async createPortal(customerId, returnUrl) {
      const s = await post<{ url: string }>("/billing_portal/sessions", {
        customer: customerId, return_url: returnUrl, ...(opts.portalConfiguration ? { configuration: opts.portalConfiguration } : {}),
      });
      return { url: s.url };
    },

    async getPlanSession(id): Promise<PlanSession | undefined> {
      const s = await call<StripeSession & { mode?: string; invoice?: StripeInvoice | string | null; subscription?: StripeSubscription | string | null }>(
        `/checkout/sessions/${encodeURIComponent(id)}?expand[]=invoice.payments&expand[]=subscription`,
      );
      const accountId = s.client_reference_id ?? "";
      if (s.mode !== "subscription" || !accountId || s.metadata?.accountId !== accountId) return undefined;
      const { byPrice } = await planPrices();
      const invoice = s.invoice && typeof s.invoice === "object" ? toPlanInvoice(s.invoice, byPrice) : undefined;
      // Fetched just now, so this is the newest state there is.
      const subscription = s.subscription && typeof s.subscription === "object" ? toSubscriptionState(s.subscription, Date.now(), byPrice) : undefined;
      return { accountId, ...(invoice ? { invoice } : {}), ...(subscription ? { subscription } : {}) };
    },

    async readPlanInvoice(raw) {
      // Another business's invoice costs no call to Stripe.
      if (raw.parent?.type !== "subscription_details" || !isOurs(raw.parent.subscription_details?.metadata)) return undefined;
      const { byPrice } = await planPrices();
      return toPlanInvoice(raw, byPrice, raw.id && raw.status === "paid" ? await invoiceIntent(raw.id) : undefined);
    },

    async readSubscription(raw, eventAt) {
      return toSubscriptionState(raw, eventAt, (await planPrices()).byPrice);
    },

    async createCheckout(req) {
      const amount = Math.round(req.pack.priceChf * 100);
      const meta = { ...MARK, accountId: req.accountId, packId: req.pack.id, credits: req.pack.credits, amount };
      const body = form({
        mode: "payment",
        client_reference_id: req.accountId,
        customer_email: req.email,
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        locale: "auto",
        line_items: {
          0: {
            quantity: 1,
            price_data: {
              currency: "chf",
              unit_amount: amount,
              product_data: { name: `${req.pack.credits.toLocaleString("de-CH")} Tevyon Credits`, description: "Für alle Bild- und Videomodelle. Gekaufte Credits verfallen nicht." },
            },
          },
        },
        metadata: meta,
        consent_collection: { terms_of_service: "required" },
        custom_text: { terms_of_service_acceptance: { message: `${WAIVER} ${linkedTerms()}` } },
        branding_settings: BRANDING,
        payment_intent_data: {
          metadata: meta,
          description: `${req.pack.credits.toLocaleString("de-CH")} Tevyon Credits. ${WAIVER} ${TERMS}`,
          receipt_email: req.email,
          statement_descriptor_suffix: STATEMENT_SUFFIX,
        },
      });
      const s = await call<StripeSession>("/checkout/sessions", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": crypto.randomUUID() },
      });
      if (!s.url) throw new Error("Stripe returned no checkout URL");
      return { id: s.id, url: s.url };
    },

    async getSession(id) {
      return toPaidSession(await call<StripeSession>(`/checkout/sessions/${encodeURIComponent(id)}`));
    },
  };
}
