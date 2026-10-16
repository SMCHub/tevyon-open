"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, Clapperboard, Coins, Download, Images, ReceiptText } from "lucide-react";
import type { CreditEntry, CreditStatement } from "@/core/credits";
import { ORIGIN_LABEL, entryTitle } from "@/lib/credit-labels";
import {
  ChargeTag, CreditCoin, CreditMeter, EntryAmount, EntryIcon, fmt, useAnimatedNumber, useDailyUsage, useStatement,
} from "@/components/studio/credits";
import {
  BILLING_ERROR, PackRows, PlanRows, buyPack, chf, confirmCheckout, isLivePlan, openPortal, settingsLine, startPlan, useBilling, usePrices,
  type PackView, type PlanView, type PriceEntry, type RowAction,
} from "@/components/studio/price-rows";
import { useStudio } from "@/components/studio/studio-context";
import { jobText } from "@/components/studio/job-views";

type Price = PriceEntry;

const DATE = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric" });
const PLAN_STATUS: Record<string, string> = {
  past_due: "The last payment is outstanding. Stripe will retry; check your payment method under “Manage plan”.",
  unpaid: "The payment is outstanding. No new plan credits until it is paid.",
  incomplete: "The first payment is not confirmed yet.",
  paused: "The plan is paused.",
};

/**
 * Plans and packs (the same rows as /pricing), purchase via Stripe Checkout, the customer portal and the return from
 * Stripe (idempotent with the webhook). With a running plan the account sees it first, with its credits and status.
 */
function TopUp({ prices, expiring }: { prices: Price[]; expiring: CreditStatement["expiring"] | undefined }) {
  const { refresh } = useStudio();
  const router = useRouter();
  const params = useSearchParams();
  const checkout = params.get("checkout");
  const abo = params.get("abo");
  const [billing, reload] = useBilling();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    const sessionId = checkout ?? abo;
    if (!sessionId) return;
    const kind = abo ? "plan" : "pack";
    if (sessionId === "cancel") {
      setNotice({ kind: "info", text: "Cancelled. Nothing was charged." });
      router.replace("/credits#top-up");
      return;
    }
    let live = true;
    confirmCheckout(sessionId, kind)
      .then(async (res) => {
        if (!live) return;
        if (res.ok) {
          setNotice({ kind: "ok", text: kind === "plan" ? `Your plan is active. ${fmt(res.credits ?? 0)} Credits for this month have been added.` : `${fmt(res.credits ?? 0)} Credits added. Thanks for your purchase.` });
          await refresh();
          reload();
        } else if (res.error === "not_paid") {
          setNotice({ kind: "info", text: "The payment is not confirmed yet. Your Credits will appear as soon as it arrives." });
        } else {
          setNotice({ kind: "error", text: "We could not match this payment to your account. If you were charged, please contact us." });
        }
        router.replace("/credits#top-up");
      })
      .catch(() => live && setNotice({ kind: "error", text: "We cannot check the payment right now. Please reload the page in a moment." }));
    return () => {
      live = false;
    };
  }, [checkout, abo, refresh, reload, router]);

  async function run(id: string, start: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id);
    setNotice(null);
    const res = await start();
    setBusy(null);
    if (!res.ok) setNotice({ kind: "error", text: BILLING_ERROR[res.error ?? ""] ?? "That could not be started. Please try again in a moment." });
  }

  const subscription = billing?.subscription ?? null;
  const live = isLivePlan(subscription);
  const plan = live ? billing?.plans.find((p) => p.id === subscription.planId) : undefined;

  function planAction(p: PlanView): RowAction {
    if (!billing?.plansEnabled) return { label: "Coming soon", disabled: true };
    if (live) return { label: subscription.planId === p.id ? "Manage" : "Switch", onClick: () => run("portal", openPortal), busy: busy === "portal", disabled: busy !== null };
    return { label: "Subscribe", onClick: () => run(p.id, () => startPlan(p.id)), busy: busy === p.id, disabled: busy !== null };
  }

  function packAction(p: PackView): RowAction {
    if (!billing?.enabled) return { label: "Coming soon", disabled: true };
    return { label: "Buy", onClick: () => run(p.id, () => buyPack(p.id)), busy: busy === p.id, disabled: busy !== null };
  }

  return (
    <section className="cr-topup" id="top-up" aria-labelledby="cr-topup-title">
      <div className="cr-section-head">
        <h2 id="cr-topup-title" className="section-title">Top up Credits</h2>
        <p className="note">A plan or a pack, paid via Stripe with card, TWINT or wallet. All prices are final prices in CHF.</p>
      </div>
      {notice && <p className={`cr-notice cr-notice--${notice.kind}`} role="status">{notice.kind === "ok" && <Check aria-hidden="true" />}{notice.text}</p>}

      {live && plan && (
        <div className="cr-plan" id="plan">
          <div className="cr-plan__main">
            <span className="cr-plan__label">Your plan</span>
            <p className="cr-plan__name">{fmt(plan.credits)} Credits a month <span>{chf(plan.priceChf)} per month</span></p>
            {expiring && <p className="cr-plan__line">{fmt(expiring.credits)} plan Credits left, valid until {DATE.format(expiring.at)}. They are used first.</p>}
            {subscription.currentPeriodEnd && (
              <p className="cr-plan__line">{subscription.cancelAtPeriodEnd ? `Cancelled, ends on ${DATE.format(subscription.currentPeriodEnd)}.` : `Renews on ${DATE.format(subscription.currentPeriodEnd)}.`}</p>
            )}
            {PLAN_STATUS[subscription.status] && <p className="cr-plan__line cr-plan__line--warn">{PLAN_STATUS[subscription.status]}</p>}
          </div>
          <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => run("portal", openPortal)}>
            {busy === "portal" ? "Opening Stripe …" : "Manage plan"}
          </button>
        </div>
      )}

      <h3 className="cr-topup__sub" id={live ? undefined : "plan"}>{live ? "Other plans" : "Plans"}</h3>
      {billing && <PlanRows plans={billing.plans} prices={prices} subscription={subscription} action={planAction} />}
      <h3 className="cr-topup__sub">No plan</h3>
      {billing && <PackRows packs={billing.packs} prices={prices} action={packAction} start={billing.plans.length + 1} />}
      {billing && !billing.enabled && <p className="note cr-topup__soon">Payments are being set up. Until then you work with your starter Credits.</p>}
    </section>
  );
}

/** What every model costs: from its cheapest settings, and with its default settings. */
function PriceList({ prices }: { prices: Price[] }) {
  if (!prices.length) return null;
  return (
    <section className="cr-card cr-prices" aria-labelledby="cr-prices">
      <header className="cr-card__head">
        <h2 id="cr-prices" className="cr-card__title">Prices per model</h2>
        <span className="cr-card__aside">in Credits, shown before every start</span>
      </header>
      <table className="cr-table">
        <thead>
          <tr><th scope="col">Model</th><th scope="col">From</th><th scope="col">Default</th><th scope="col">Settings</th></tr>
        </thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.jobType}>
              <th scope="row"><span className="cr-table__kind">{p.kind === "video" ? <Clapperboard aria-hidden="true" /> : <Images aria-hidden="true" />}</span>{p.model}</th>
              <td>{fmt(p.from)}</td>
              <td><strong>{fmt(p.standard)}</strong></td>
              <td className="cr-table__muted">{settingsLine(p.settings)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">If a job fails or the content filter blocks it, the Credits are refunded in full.</p>
    </section>
  );
}

type Filter = "all" | "spent" | "granted" | "refunded";
const FILTERS: { id: Filter; label: string; test: (e: CreditEntry) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "spent", label: "Spent", test: (e) => e.kind === "job" && e.state !== "refunded" },
  { id: "granted", label: "Added", test: (e) => e.kind === "grant" },
  { id: "refunded", label: "Refunds", test: (e) => e.kind === "job" && e.state === "refunded" },
];

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "long" });
const TIME = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" });
const SHORT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "numeric" });

function dayLabel(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return DAY.format(ms);
}

/** Clean axis maximum: 1, 2 or 5 times a power of ten. */
function niceMax(v: number) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

function UsageChart({ entries }: { entries: CreditEntry[] }) {
  const days = useDailyUsage(entries, 30);
  const total = days.reduce((s, d) => s + d.credits, 0);
  const max = niceMax(Math.max(...days.map((d) => d.credits)));
  return (
    <section className="cr-card cr-chart" aria-labelledby="cr-usage">
      <header className="cr-card__head">
        <h2 id="cr-usage" className="cr-card__title">Usage, last 30 days</h2>
        <span className="cr-card__aside">{fmt(total)} Credits</span>
      </header>
      {total === 0 ? (
        <p className="cr-chart__empty">No usage in the last 30 days.</p>
      ) : (
        <div className="cr-cols" role="img" aria-label={`Usage per day, ${fmt(total)} Credits in 30 days in total`}>
          <div className="cr-cols__grid" aria-hidden="true">
            <span data-v={fmt(max)} />
            <span data-v={fmt(max / 2)} />
            <span data-v="0" />
          </div>
          <div className="cr-cols__plot">
            {days.map((d, i) => (
              <div
                key={d.start}
                className={`cr-col${d.credits ? "" : " is-zero"}`}
                tabIndex={d.credits ? 0 : -1}
                aria-label={d.credits ? `${SHORT.format(d.start)}: ${fmt(d.credits)} Credits, ${d.jobs} ${d.jobs === 1 ? "Job" : "Jobs"}` : undefined}
              >
                <span className="cr-col__bar" style={{ height: `${(d.credits / max) * 100}%` }} />
                {d.credits > 0 && (
                  <span className="cr-tip" role="tooltip">
                    <strong>{fmt(d.credits)} Credits</strong>
                    <span>{SHORT.format(d.start)} · {d.jobs} {d.jobs === 1 ? "Job" : "Jobs"}</span>
                  </span>
                )}
                {(i % 7 === 2 || i === days.length - 1) && <span className="cr-col__x">{i === days.length - 1 ? "Today" : SHORT.format(d.start)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ByModel({ entries }: { entries: CreditEntry[] }) {
  const rows = useMemo(() => {
    const by = new Map<string, { model: string; jobType: string; credits: number; jobs: number }>();
    for (const e of entries) {
      if (e.kind !== "job" || e.state !== "charged") continue;
      const r = by.get(e.jobType) ?? { model: e.model, jobType: e.jobType, credits: 0, jobs: 0 };
      r.credits += e.amount;
      r.jobs += 1;
      by.set(e.jobType, r);
    }
    return [...by.values()].sort((a, b) => b.credits - a.credits);
  }, [entries]);
  const max = Math.max(1, ...rows.map((r) => r.credits));
  return (
    <section className="cr-card" aria-labelledby="cr-models">
      <header className="cr-card__head">
        <h2 id="cr-models" className="cr-card__title">By model</h2>
        <span className="cr-card__aside">all time</span>
      </header>
      {rows.length === 0 ? (
        <p className="cr-chart__empty">Once a job is charged, you see here what each model costs.</p>
      ) : (
        <ul className="cr-bars">
          {rows.map((r) => (
            <li key={r.jobType} className="cr-bars__row">
              <span className="cr-bars__label">
                <span className="cr-bars__model">{r.model}</span>
                <span className="cr-bars__jobs">{r.jobs} {r.jobs === 1 ? "Job" : "Jobs"}</span>
              </span>
              <span className="cr-bars__track" aria-hidden="true">
                <span className="cr-bars__fill" style={{ width: `${(r.credits / max) * 100}%` }} />
              </span>
              <span className="cr-bars__value">{fmt(r.credits)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Statement({ entries }: { entries: CreditEntry[] }) {
  const { jobs } = useStudio();
  const [filter, setFilter] = useState<Filter>("all");
  const prompts = useMemo(() => new Map(jobs.map((j) => [j.id, jobText(j)])), [jobs]);
  const shown = entries.filter(FILTERS.find((f) => f.id === filter)!.test);
  const groups = useMemo(() => {
    const out: { label: string; items: CreditEntry[] }[] = [];
    for (const e of shown) {
      const label = dayLabel(e.at);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [shown]);

  return (
    <section className="cr-statement" aria-labelledby="cr-statement">
      <div className="cr-statement__head">
        <h2 id="cr-statement" className="section-title">Transactions</h2>
        <div className="filters" role="tablist" aria-label="Filter transactions">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="filters__item" onClick={() => setFilter(f.id)}>
              {f.label} <span className="count">{entries.filter(f.test).length}</span>
            </button>
          ))}
        </div>
      </div>
      {groups.length === 0 ? (
        <div className="empty cr-statement__empty">
          <ReceiptText aria-hidden="true" />
          <p>No transactions in this view.</p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.label} className="cr-day">
            <h3 className="cr-day__label">{g.label}</h3>
            <ul className="cr-rows">
              {g.items.map((e) => (
                <li key={e.id} className={`cr-row${e.kind === "job" || e.kind === "director" ? ` cr-row--${e.state}` : ` cr-row--${e.kind}`}`}>
                  <EntryIcon entry={e} />
                  <span className="cr-row__main">
                    <span className="cr-row__title">{entryTitle(e)}</span>
                    <span className="cr-row__meta">
                      <span>{TIME.format(e.at)}</span>
                      {e.kind === "job" ? (
                        <>
                          <span>{ORIGIN_LABEL[e.origin]}</span>
                          <ChargeTag entry={e} />
                        </>
                      ) : e.kind === "director" ? (
                        <ChargeTag entry={e} />
                      ) : (
                        <span>{e.kind === "grant" ? "added" : e.credits < 0 ? "deducted" : "refunded"}</span>
                      )}
                    </span>
                    {e.kind === "job" && prompts.get(e.jobId) && <span className="cr-row__prompt">{prompts.get(e.jobId)}</span>}
                  </span>
                  <EntryAmount entry={e} />
                  <span className="cr-row__balance" title="Balance after this transaction">{fmt(e.balance)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

export function CreditsPage() {
  const { me } = useStudio();
  const { statement, failed } = useStatement();
  const prices = usePrices();
  const available = useAnimatedNumber(me?.credits ?? statement?.summary.available ?? null);
  const s = statement?.summary;

  return (
    <div className="studio cr-page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Credits</h1>
          <p className="page-sub">Balance, usage and every transaction. The price is fixed before every job. If a job fails, the Credits are refunded automatically.</p>
        </div>
        <div className="cr-page__actions">
          <a className="btn" href="/api/credits?format=csv" download>
            <Download aria-hidden="true" /> Export CSV
          </a>
          <a className="btn btn--primary" href="#top-up">
            <Coins aria-hidden="true" /> Top up Credits
          </a>
        </div>
      </header>

      {failed && !statement && <p className="note note--error" role="alert">The statement cannot be loaded right now. Please try again later.</p>}

      <section className="cr-hero" aria-label="Balance">
        <div className="cr-hero__main">
          <span className="cr-hero__label">Available</span>
          <p className="cr-hero__value">
            <CreditCoin size={40} />
            <span className="cr-hero__num">{available === null ? "…" : fmt(available)}</span>
            <span className="cr-hero__unit">Credits</span>
          </p>
          {s && <CreditMeter summary={s} size="lg" />}
          {statement?.expiring && (
            <p className="cr-hero__plan">including {fmt(statement.expiring.credits)} plan Credits, valid until {new Date(statement.expiring.at).toLocaleDateString("en-US", { day: "numeric", month: "long" })}</p>
          )}
          {s && s.owed > 0 && (
            <p className="cr-owed" role="status">
              Outstanding: {fmt(s.owed)} Credits from a refund or a payment dispute. New Credits settle this amount first; until then nothing starts.
            </p>
          )}
        </div>
        <dl className="cr-kpis">
          <div className="cr-kpi">
            <dt><span className="cr-dot cr-dot--reserved" aria-hidden="true" /> Reserved</dt>
            <dd>{s ? fmt(s.reserved) : "…"}</dd>
            <p>for running jobs</p>
          </div>
          <div className="cr-kpi">
            <dt><span className="cr-dot cr-dot--charged" aria-hidden="true" /> Spent</dt>
            <dd>{s ? fmt(s.spent) : "…"}</dd>
            <p>for finished results</p>
          </div>
          <div className="cr-kpi">
            <dt>Refunded</dt>
            <dd>{s ? fmt(s.refunded) : "…"}</dd>
            <p>on failure or moderation</p>
          </div>
          <div className="cr-kpi">
            <dt>Received</dt>
            <dd>{s ? fmt(s.granted) : "…"}</dd>
            <p>total added</p>
          </div>
        </dl>
      </section>

      <TopUp prices={prices} expiring={statement?.expiring} />

      {statement && (
        <div className="cr-grid">
          <UsageChart entries={statement.entries} />
          <ByModel entries={statement.entries} />
        </div>
      )}
      <PriceList prices={prices} />
      {statement && <Statement entries={statement.entries} />}

      <p className="note cr-page__foot">
        Create in the <Link href="/image">image</Link> and <Link href="/video">video studio</Link>, via the CLI and via the MCP server, all with the same Credits.
      </p>
    </div>
  );
}
