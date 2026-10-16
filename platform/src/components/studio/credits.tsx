"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CalendarSync, Clapperboard, Coins, Gift, Hourglass, Images, MessageSquare, RotateCcw, Undo2 } from "lucide-react";
import type { CreditEntry, CreditStatement, CreditSummary } from "@/core/credits";
import { CHARGE_LABEL, GRANT_LABEL, ORIGIN_LABEL, entryTitle, signed } from "@/lib/credit-labels";
import { JOB_ERROR, MODEL_COVER } from "./content";
import { BILLING_ERROR, buyPack, chf, type BillingView, type PackView } from "./price-rows";
import { useStudio, type StartResult } from "./studio-context";
import { TachyonToken } from "./tachyon-token";
import "./credits.css";

const fmt = (n: number) => n.toLocaleString("de-CH");

/** The credits line of a job: what it holds while running, what it cost, or what came back. */
export function chargeLine(job: { status: string; credits: number }): string {
  if (job.status === "failed") return `0 · ${fmt(job.credits)} zurück`;
  if (job.status === "succeeded") return `${fmt(job.credits)} abgebucht`;
  return `${fmt(job.credits)} reserviert`;
}

/** "4 × 7 = 28 Credits, danach 40 übrig": the price on a start button, spelled out. */
export function priceText(price: number | null, count: number, balance: number | null): string {
  if (price === null) return "Preis wird berechnet";
  const total = price * count;
  const sum = count > 1 ? `${count} × ${fmt(price)} = ${fmt(total)} Credits` : `${fmt(total)} Credits`;
  if (balance === null) return sum;
  return balance >= total ? `${sum}, danach ${fmt(balance - total)} übrig` : `${sum}, es fehlen ${fmt(total - balance)}`;
}

// Packs, plans and the account's plan, asked once per page load: the note appears and disappears with every price.
let billingOnce: Promise<BillingView | null> | null = null;
function useBillingOnce(): BillingView | null {
  const [billing, setBilling] = useState<BillingView | null>(null);
  useEffect(() => {
    billingOnce ??= fetch("/api/billing", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<BillingView>) : null)).catch(() => null);
    let live = true;
    void billingOnce.then((b) => live && setBilling(b));
    return () => {
      live = false;
    };
  }, []);
  return billing;
}

/**
 * The "not enough credits" note under a generator: the shortfall, how far the balance reaches, and the smallest pack
 * that covers it (else the biggest), straight to the checkout. Without payments it leads to the credits page.
 */
export function NotEnough({ need, have, className = "" }: { need: number; have: number; className?: string }) {
  const billing = useBillingOnce();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = Math.max(0, need - have);
  const reach = need > 0 ? Math.min(1, Math.max(0, have / need)) : 0;
  const offer: PackView | null = billing?.enabled && billing.packs.length
    ? billing.packs.find((p) => p.credits >= short) ?? billing.packs.at(-1)!
    : null;

  async function buy() {
    if (!offer) return;
    setBusy(true);
    setError(null);
    const res = await buyPack(offer.id);
    // Still here: the checkout did not open.
    setBusy(false);
    if (!res.ok) setError(BILLING_ERROR[res.error ?? ""] ?? "Das liess sich gerade nicht starten.");
  }

  return (
    <div className={`short ${className}`.trim()} role="status">
      <div className="short__text">
        <p className="short__title">{fmt(short)} Credits fehlen <span className="short__meta">· {fmt(have)} von {fmt(need)}</span></p>
        <span className="short__bar" aria-hidden="true"><span style={{ width: `${reach * 100}%` }} /></span>
        {offer && (
          <p className={`short__offer${error ? " is-error" : ""}`}>
            {error ?? `${fmt(offer.credits)} Credits für ${chf(offer.priceChf)}, verfallen nie`}
          </p>
        )}
      </div>
      {offer ? (
        <button type="button" className="short__cta" onClick={buy} disabled={busy}>
          {busy ? "Weiter …" : "Kaufen"} <ArrowUpRight aria-hidden="true" />
        </button>
      ) : (
        <Link href="/credits" className="short__cta">
          Credits <ArrowUpRight aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/** What went wrong when starting, including how many of several jobs did start and a changed price. */
export function startErrorText(res: Extract<StartResult, { ok: false }>, count = 1): string {
  const why = res.error === "price_changed" && res.credits !== undefined
    ? `Der Preis hat sich gerade geändert: jetzt ${fmt(res.credits)} Credits pro Job. Prüf ihn und starte noch einmal.`
    : JOB_ERROR[res.error] ?? "Job konnte nicht gestartet werden.";
  return res.started > 0 ? `${res.started} von ${count} gestartet. ${why}` : why;
}

/** The account's statement from /api/credits, refetched whenever the balance or a job's state changes. */
export function useStatement({ limit, enabled = true }: { limit?: number; enabled?: boolean } = {}) {
  const { me, jobs } = useStudio();
  const [data, setData] = useState<CreditStatement | null>(null);
  const [failed, setFailed] = useState(false);
  const signature = `${me?.credits ?? ""}|${jobs.map((j) => `${j.id}:${j.status}`).join(",")}`;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/credits${limit ? `?limit=${limit}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CreditStatement>) : Promise.reject(new Error(String(r.status)))))
      .then(
        (d) => {
          if (!live) return;
          setData(d);
          setFailed(false);
        },
        () => live && setFailed(true),
      );
    return () => {
      live = false;
    };
  }, [enabled, limit, signature]);

  return { statement: data, failed };
}

/** Credits held by the account's queued and running jobs, straight from the job list. */
export function useReserved() {
  const { jobs } = useStudio();
  return jobs.reduce((sum, j) => (j.status === "queued" || j.status === "running" ? sum + j.credits : sum), 0);
}

/** Counts to a new value instead of jumping (off with reduced motion). */
export function useAnimatedNumber(target: number | null, ms = 650) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (target === null) return;
    const from = current.current;
    if (from === null || from === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const value = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      current.current = value;
      setShown(value);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return shown;
}

/** The credit glyph: the Tachyon token, a warm coin (Glut to gold) with the T, the one place where credits carry colour. */
export function CreditCoin({ size = 22 }: { size?: number }) {
  return (
    <span className="cr-coin" style={{ width: size, height: size }} aria-hidden="true">
      <TachyonToken size={size} />
    </span>
  );
}

/**
 * Part-to-whole of everything granted: available (photon), reserved by running jobs (Nacht), spent (Glut).
 * Colours validated for dark mode and colour blindness; the legend names every part, so colour never stands alone.
 */
export function CreditMeter({ summary, size = "sm" }: { summary: CreditSummary; size?: "sm" | "lg" }) {
  // The parts add up to what was granted minus what a refund or dispute took back.
  const total = Math.max(summary.available + summary.reserved + summary.spent, 1);
  const parts = [
    { key: "available", label: "Verfügbar", value: summary.available },
    { key: "reserved", label: "Reserviert", value: summary.reserved },
    { key: "spent", label: "Verbraucht", value: summary.spent },
  ] as const;
  return (
    <div className={`cr-meter cr-meter--${size}`}>
      <div
        className="cr-meter__bar"
        role="img"
        aria-label={`${fmt(summary.available)} verfügbar, ${fmt(summary.reserved)} reserviert, ${fmt(summary.spent)} verbraucht von ${fmt(summary.granted - summary.debited)} erhaltenen Credits`}
      >
        {parts.map((p) =>
          p.value > 0 ? <span key={p.key} className={`cr-meter__seg cr-meter__seg--${p.key}`} style={{ flexGrow: p.value / total }} /> : null,
        )}
      </div>
      <ul className="cr-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className={`cr-legend__key cr-legend__key--${p.key}`} aria-hidden="true" />
            <span className="cr-legend__label">{p.label}</span>
            <span className="cr-legend__value">{fmt(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function timeAgo(ms: number) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  return new Date(ms).toLocaleDateString("de-CH", { day: "numeric", month: "short" });
}

/** Icon of a statement line: the model's cover for jobs, a gift for grants. */
export function EntryIcon({ entry }: { entry: CreditEntry }) {
  const { kindOf } = useStudio();
  if (entry.kind === "grant") {
    return (
      <span className="cr-ico cr-ico--grant" aria-hidden="true">
        {entry.source === "purchase" ? <Coins /> : entry.source === "subscription" ? <CalendarSync /> : <Gift />}
      </span>
    );
  }
  if (entry.kind === "director") return <span className="cr-ico" aria-hidden="true"><MessageSquare /></span>;
  if (entry.kind === "reversal") return <span className="cr-ico cr-ico--reversal" aria-hidden="true"><Undo2 /></span>;
  if (entry.kind === "expiry") return <span className="cr-ico cr-ico--expiry" aria-hidden="true"><Hourglass /></span>;
  const cover = MODEL_COVER[entry.jobType];
  return (
    <span className="cr-ico" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {cover ? <img src={cover} alt="" /> : kindOf(entry.jobType) === "video" ? <Clapperboard /> : <Images />}
    </span>
  );
}

/** Status of a job line: dot plus words, never colour alone. */
export function ChargeTag({ entry }: { entry: Extract<CreditEntry, { kind: "job" | "director" }> }) {
  return (
    <span className={`cr-state cr-state--${entry.state}`}>
      {entry.state === "refunded" ? <RotateCcw aria-hidden="true" /> : <span className={`cr-dot cr-dot--${entry.state}`} aria-hidden="true" />}
      {CHARGE_LABEL[entry.state]}
    </span>
  );
}

/** Amount column: the change of the balance; a refunded job shows ±0 with what came back. */
export function EntryAmount({ entry }: { entry: CreditEntry }) {
  if ((entry.kind === "job" || entry.kind === "director") && entry.state === "refunded") {
    return (
      <span className="cr-amount cr-amount--zero">
        ±0<small>{fmt(entry.amount)} zurück</small>
      </span>
    );
  }
  return <span className={`cr-amount${entry.credits > 0 ? " cr-amount--plus" : ""}`}>{signed(entry.credits)}</span>;
}

/**
 * Balance in the account menu (the header shows no credits): coin, the counting number, what running jobs hold, and a
 * way to top up. The statement with every movement is one click away (/credits).
 */
export function AccountBalance({ onNavigate }: { onNavigate: () => void }) {
  const { me } = useStudio();
  const reserved = useReserved();
  const credits = me?.credits ?? null;
  const shown = useAnimatedNumber(credits);
  return (
    <div className={`acct__balance${credits === 0 ? " is-empty" : ""}`}>
      <div className="acct__balance-top">
        <span className="acct__balance-label">Credits</span>
        <Link href="/credits#aufladen" className="acct__topup" onClick={onNavigate}>
          <Coins aria-hidden="true" /> Aufladen
        </Link>
      </div>
      <p className="acct__balance-sum" aria-live="polite">
        <CreditCoin size={24} />
        <span className="acct__balance-num">{shown === null ? "…" : fmt(shown)}</span>
        <span className="acct__balance-unit">verfügbar</span>
      </p>
      {reserved > 0 && (
        <p className="acct__balance-hold"><span className="cr-dot cr-dot--reserved" aria-hidden="true" /> {fmt(reserved)} reserviert für laufende Jobs</p>
      )}
    </div>
  );
}

export { GRANT_LABEL, ORIGIN_LABEL, fmt, timeAgo };

/** Days of the last `n` days (local time), oldest first, with credits charged and jobs per day. */
export function useDailyUsage(entries: CreditEntry[] | undefined, n = 30) {
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: n }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (n - 1 - i));
      return { start: d.getTime(), credits: 0, jobs: 0 };
    });
    const first = days[0]!.start;
    for (const e of entries ?? []) {
      if (e.kind !== "job" || e.state !== "charged" || e.at < first) continue;
      const day = new Date(e.at);
      day.setHours(0, 0, 0, 0);
      const slot = days.find((d) => d.start === day.getTime());
      if (slot) {
        slot.credits += e.amount;
        slot.jobs += 1;
      }
    }
    return days;
  }, [entries, n]);
}
