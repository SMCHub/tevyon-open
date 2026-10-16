"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { showValue } from "./schema";
import "./price-rows.css";

/**
 * Plans (Abo) and packs as one editorial list, shared by the public price page (/preise) and the account (/credits).
 * Rows, not cards: a number, the credits, one price in CHF incl. VAT, the price per credit and what the credits make
 * with a named model and setting. No badge, no struck price, no toggle: the row under the pointer is the highlight.
 */
export type PriceEntry = { jobType: string; model: string; kind: "image" | "video"; from: number; standard: number; settings: Record<string, unknown> };
export type PackView = { id: string; credits: number; priceChf: number; rappenPerCredit: number; saving: number };
export type PlanView = { id: string; credits: number; priceChf: number; rappenPerCredit: number };
export type SubscriptionView = { planId: string; status: string; currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean };
export type BillingView = { enabled: boolean; plansEnabled: boolean; packs: PackView[]; plans: PlanView[]; subscription: SubscriptionView | null };

export const fmt = (n: number) => n.toLocaleString("de-CH");
export const chf = (n: number) => (Number.isInteger(n) ? `CHF ${n}.–` : `CHF ${n.toFixed(2)}`);
const rappen = (n: number) => `${n.toFixed(2).replace(".", ",")} Rp`;

/**
 * The public price list (/api/prices): every model in credits, from its cheapest and at its standard settings. `initial`
 * is the list the server rendered the page with; the fetch adds models that went live since.
 */
export function usePrices(initial: PriceEntry[] = []): PriceEntry[] {
  const [prices, setPrices] = useState<PriceEntry[]>(initial);
  useEffect(() => {
    fetch("/api/prices").then((r) => r.json()).then((d: { prices: PriceEntry[] }) => setPrices(d.prices)).catch(() => {});
  }, []);
  return prices;
}

/** Packs, plans and the signed-in account's plan (/api/billing); `initial` is what the server rendered (no plan of anyone). */
export function useBilling(initial: BillingView | null = null): [BillingView | null, () => void] {
  const [billing, setBilling] = useState<BillingView | null>(initial);
  const load = useCallback(() => {
    fetch("/api/billing", { cache: "no-store" }).then((r) => r.json()).then(setBilling)
      .catch(() => setBilling((b) => b ?? { enabled: false, plansEnabled: false, packs: [], plans: [], subscription: null }));
  }, []);
  useEffect(load, [load]);
  return [billing, load];
}

/** A plan that is still running or still has to be paid: the account manages it in the portal instead of buying another. */
export const isLivePlan = (s: SubscriptionView | null | undefined): s is SubscriptionView =>
  Boolean(s && ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"].includes(s.status));

/** The settings that make a price, as words ("8 s · 720p · Mit Ton"); empty lists (no reference images) say nothing. */
export const settingsLine = (settings: Record<string, unknown>) =>
  Object.entries(settings).filter(([, v]) => !(Array.isArray(v) && v.length === 0) && v !== "" && v !== null).map(([k, v]) => showValue(k, v)).join(" · ");

/** What a number of credits makes, with the model and setting named (never «up to» on a model nobody uses). */
export function equivalents(credits: number, prices: PriceEntry[]): string[] {
  const video = prices.find((p) => p.jobType === "veo_3_1_lite");
  const image = prices.find((p) => p.jobType === "flux_3_image");
  const out: string[] = [];
  if (video) {
    const audio = video.settings.generate_audio === true ? " mit Ton" : "";
    out.push(`${fmt(Math.floor(credits / video.standard))} Clips ${video.model}, ${showValue("duration", video.settings.duration)}${audio}`);
  }
  if (image) out.push(`${fmt(Math.floor(credits / image.standard))} Bilder ${image.model}`);
  return out;
}

export type RowAction = { label: string; onClick?: () => void; href?: string; disabled?: boolean; busy?: boolean };

function Action({ action }: { action: RowAction }) {
  const inner = (
    <>
      <span>{action.busy ? "Weiter zu Stripe …" : action.label}</span>
      <span className="prow__arrow" aria-hidden="true"><ArrowRight /></span>
    </>
  );
  if (action.href && !action.disabled) return <Link className="prow__go" href={action.href}>{inner}</Link>;
  return <button type="button" className="prow__go" disabled={action.disabled || action.busy} onClick={action.onClick}>{inner}</button>;
}

function Row({ no, credits, unit, price, priceUnit, per, eq, tag, action }: {
  no: number; credits: number; unit: string; price: number; priceUnit?: string; per: number; eq: string[]; tag?: string; action: RowAction;
}) {
  return (
    <li className={`prow${tag ? " is-mine" : ""}`}>
      <span className="prow__no" aria-hidden="true">{String(no).padStart(2, "0")}</span>
      <span className="prow__title">
        <span className="prow__credits">{fmt(credits)}</span>
        <span className="prow__unit">{unit}</span>
        {tag && <span className="prow__tag">{tag}</span>}
      </span>
      <span className="prow__price">{chf(price)}{priceUnit && <small>{priceUnit}</small>}</span>
      <span className="prow__per">{rappen(per)}<small>pro Credit</small></span>
      <span className="prow__eq">{eq.map((line, i) => <span key={line}>{i === 0 ? "≈ " : ""}{line}</span>)}</span>
      <Action action={action} />
    </li>
  );
}

export function PlanRows({ plans, prices, subscription, action }: {
  plans: PlanView[]; prices: PriceEntry[]; subscription?: SubscriptionView | null; action: (plan: PlanView) => RowAction;
}) {
  return (
    <ol className="prows" aria-label="Abos">
      {plans.map((p, i) => (
        <Row
          key={p.id} no={i + 1} credits={p.credits} unit="Credits im Monat" price={p.priceChf} priceUnit="pro Monat" per={p.rappenPerCredit}
          eq={equivalents(p.credits, prices)} {...(isLivePlan(subscription) && subscription.planId === p.id ? { tag: "Dein Abo" } : {})} action={action(p)}
        />
      ))}
    </ol>
  );
}

export function PackRows({ packs, prices, action, start = 1 }: { packs: PackView[]; prices: PriceEntry[]; action: (pack: PackView) => RowAction; start?: number }) {
  return (
    <ol className="prows" aria-label="Pakete ohne Abo">
      {packs.map((p, i) => (
        <Row key={p.id} no={start + i} credits={p.credits} unit="Credits, einmal" price={p.priceChf} priceUnit="einmalig" per={p.rappenPerCredit} eq={equivalents(p.credits, prices)} action={action(p)} />
      ))}
    </ol>
  );
}

/** Wording for what the billing routes answer. */
export const BILLING_ERROR: Record<string, string> = {
  plan_exists: "Du hast schon ein Abo. Wechseln und kündigen geht unter Credits im Konto.",
  payments_unavailable: "Zahlungen werden gerade eingerichtet. Bis dahin arbeitest du mit deinen Credits zum Start.",
  unknown_plan: "Dieses Abo gibt es nicht.",
  unknown_pack: "Dieses Paket gibt es nicht.",
  no_subscription: "Zu diesem Konto gibt es kein Abo.",
  unauthorized: "Bitte melde dich zuerst an.",
};

async function post(path: string, body?: object): Promise<{ ok: boolean; url?: string; error?: string; credits?: number }> {
  return fetch(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }).then((r) => r.json()).catch(() => ({ ok: false }));
}

/** Starts Stripe Checkout for a plan or a pack, or opens the customer portal. Resolves only when it could not leave the page. */
export async function startPlan(planId: string) {
  const res = await post("/api/billing/subscribe", { planId });
  if (res.ok && res.url) window.location.assign(res.url);
  return res;
}

export async function buyPack(packId: string) {
  const res = await post("/api/billing/checkout", { packId });
  if (res.ok && res.url) window.location.assign(res.url);
  return res;
}

export async function openPortal() {
  const res = await post("/api/billing/portal");
  if (res.ok && res.url) window.location.assign(res.url);
  return res;
}

export async function confirmCheckout(sessionId: string, kind: "pack" | "plan") {
  return post("/api/billing/confirm", { sessionId, ...(kind === "plan" ? { kind } : {}) });
}
