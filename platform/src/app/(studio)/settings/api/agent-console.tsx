"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  KeyRound,
  Plug,
  Plus,
  SquareTerminal,
} from "lucide-react";
import type { ApiKeyView } from "@/core/api-keys";
import type { AccessKey, AccessOverview, AgentActivity } from "@/server/access-overview";
import { ConnectTabs } from "./connect-tabs";
import { CopyButton, RelativeTime, UsageMeter } from "./console-parts";
import { KeyDialog } from "./key-dialog";
import { EFFECT_LABEL, TOOL_CARDS } from "./tool-cards";

/** Daily limits offered per key; a custom value set elsewhere stays selectable. */
const LIMITS = [50, 100, 300, 1000, 3000];
const POLL_MS = 15_000;
/** A key used this recently counts as active right now. */
const LIVE_MS = 5 * 60_000;

const STATUS: Record<AgentActivity["status"], string> = { queued: "Queued", running: "Running", succeeded: "Done", failed: "Failed" };
const FAILURE: Record<NonNullable<AgentActivity["error"]>, string> = {
  content_moderated: "Stopped by moderation",
  invalid_request: "Invalid request",
  generation_failed: "Generation failed",
  timed_out: "Timed out",
};
const CHANNEL: Record<AgentActivity["origin"], string> = { mcp: "MCP", cli: "CLI", api: "API" };


const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A state change as a view transition (rows close up instead of jumping), where the browser has them and motion is welcome. */
function transition(update: () => void) {
  if (typeof document.startViewTransition !== "function" || reducedMotion()) return update();
  document.startViewTransition(() => flushSync(update));
}

function KeyIcon({ k }: { k: AccessKey }) {
  if (k.kind === "oauth") return <Plug />;
  if (/\bcli\b/i.test(k.name)) return <SquareTerminal />;
  return <KeyRound />;
}

function KeyRow(props: {
  k: AccessKey;
  now: number;
  armed: boolean;
  isNew: boolean;
  onArm(armed: boolean): void;
  onRevoke(): void;
  onLimit(value: string): void;
}) {
  const { k, now, armed, isNew } = props;
  const live = k.lastUsedAt !== null && now - k.lastUsedAt < LIVE_MS;
  const limits = [...new Set([...LIMITS, ...(k.dailyLimit === null ? [] : [k.dailyLimit])])].sort((a, b) => a - b);
  const verb = k.kind === "oauth" ? "disconnect" : "revoke";
  return (
    <li className="ac-key" data-key={k.id} data-new={isNew || undefined} style={{ viewTransitionName: `key-${k.id}` }}>
      <span className="ac-key__icon" aria-hidden="true"><KeyIcon k={k} /></span>
      <div className="ac-key__who">
        <p className="ac-key__name">
          <span>{k.name}</span>
          {k.kind === "oauth" && <span className="ac-badge">App</span>}
        </p>
        <p className="ac-key__meta">
          {k.kind === "oauth" ? <span>via OAuth</span> : <code>{k.prefix}…</code>}
          {k.lastUsedAt ? (
            <span className="ac-key__seen" data-live={live || undefined}>
              {live && <i className="ac-live" aria-hidden="true" />}last active <RelativeTime ms={k.lastUsedAt} />
            </span>
          ) : (
            <span>never used</span>
          )}
        </p>
      </div>
      <UsageMeter spent={k.spent24h} limit={k.dailyLimit} />
      <div className="ac-key__actions">
        <label className="ac-select">
          <span className="ac-sr">Daily limit of {k.name}</span>
          <select value={k.dailyLimit === null ? "none" : String(k.dailyLimit)} onChange={(e) => props.onLimit(e.target.value)}>
            {limits.map((n) => (
              <option key={n} value={n}>{n.toLocaleString("en-US")} Credits</option>
            ))}
            <option value="none">No limit</option>
          </select>
        </label>
        <button
          type="button"
          className="ac-revoke"
          data-armed={armed || undefined}
          onClick={() => (armed ? props.onRevoke() : props.onArm(true))}
          onBlur={() => props.onArm(false)}
          onKeyDown={(e) => e.key === "Escape" && props.onArm(false)}
          aria-label={armed ? `Really ${verb} ${k.name}?` : `${verb === "revoke" ? "Revoke" : "Disconnect"} ${k.name}`}
        >
          {armed ? `Really ${verb}?` : k.kind === "oauth" ? "Disconnect" : "Revoke"}
        </button>
      </div>
    </li>
  );
}

function ActivityCard({ a }: { a: AgentActivity }) {
  const result = a.status === "succeeded" ? a.preview : null;
  return (
    <li className="ac-act" data-status={a.status}>
      <div className="ac-act__media">
        {result ? (
          <a href={result} target="_blank" rel="noopener" aria-label={`Open result from ${a.model}`}>
            {a.media === "video" ? (
              <video
                src={`${result}#t=0.1`}
                muted
                playsInline
                loop
                preload="metadata"
                onPointerEnter={(e) => {
                  if (!reducedMotion()) void e.currentTarget.play().catch(() => {});
                }}
                onPointerLeave={(e) => e.currentTarget.pause()}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result} alt="" loading="lazy" decoding="async" />
            )}
          </a>
        ) : (
          <div className="ac-act__slate">
            <span>{a.preset ? `Preset “${a.preset}”` : a.prompt || "No prompt"}</span>
          </div>
        )}
        <span className="ac-pill" data-status={a.status}>{STATUS[a.status]}</span>
        <span className="ac-act__via">{CHANNEL[a.origin]}</span>
      </div>
      <div className="ac-act__body">
        <p className="ac-act__model">{a.model}</p>
        {result && <p className="ac-act__prompt">{a.preset ? `Preset “${a.preset}”${a.prompt ? ` · ${a.prompt}` : ""}` : a.prompt || "No prompt"}</p>}
        {a.error && <p className="ac-act__error">{FAILURE[a.error]}</p>}
        <p className="ac-act__meta">
          <span>{a.status === "failed" ? `${a.credits} Credits refunded` : `${a.credits} Credits`}</span>
          <span>{a.keyName ?? "revoked access"}</span>
          <RelativeTime ms={a.createdAt} />
        </p>
      </div>
    </li>
  );
}

/**
 * The "API & MCP" console: what connects to the account (keys and apps, with spend and limit), how to connect a
 * client, what agents did lately and what they can do. Starts from the server's data and polls while visible;
 * revoking and limits change at once and roll back if the server says no.
 */
export function AgentConsole({ origin, initial, now: serverNow, className = "" }: { origin: string; initial: AccessOverview; now: number; className?: string }) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(serverNow);
  const [dialog, setDialog] = useState(false);
  const [fresh, setFresh] = useState<{ id: string; key: string } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [toast, setToast] = useState<{ n: number; text: string; error: boolean } | null>(null);
  const toastEl = useRef<HTMLDivElement>(null);
  const reel = useRef<HTMLOListElement>(null);
  const newKey = useRef<HTMLButtonElement>(null);
  /** Changes in flight. A poll answered meanwhile would undo the optimistic state, so it is dropped. */
  const pending = useRef(0);
  const endpoint = `${origin}/api/mcp`;
  const { keys, activity } = data;

  useEffect(() => {
    let ctrl: AbortController | undefined;
    const poll = async () => {
      if (document.visibilityState !== "visible" || pending.current > 0) return;
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch("/api/keys", { cache: "no-store", signal: ctrl.signal });
        if (res.ok) {
          const next = (await res.json()) as AccessOverview;
          if (pending.current === 0) setData(next);
        }
        setNow(Date.now());
      } catch {
        // Offline or aborted: keep what is shown.
      }
    };
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      ctrl?.abort();
    };
  }, []);

  useEffect(() => {
    const el = toastEl.current;
    if (!toast || !el) return;
    try {
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      // No popover support: the message still reaches screen readers through the status line.
    }
    const t = setTimeout(() => {
      try {
        el.hidePopover();
      } catch {
        // Already hidden.
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const say = (text: string, error = false) => setToast((t) => ({ n: (t?.n ?? 0) + 1, text, error }));

  async function revoke(k: AccessKey) {
    setArmed(null);
    const at = keys.findIndex((x) => x.id === k.id);
    const next = keys[at + 1]?.id;
    pending.current++;
    transition(() => setData((d) => ({ ...d, keys: d.keys.filter((x) => x.id !== k.id) })));
    if (fresh?.id === k.id) setFresh(null);
    requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-key="${next}"] select`) ?? newKey.current)?.focus());
    try {
      const res = await fetch(`/api/keys/${k.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`status ${res.status}`);
      say(k.kind === "oauth" ? `“${k.name}” is disconnected. The app has to sign in again.` : `“${k.name}” is revoked and stops working right away.`);
    } catch {
      transition(() => setData((d) => (d.keys.some((x) => x.id === k.id) ? d : { ...d, keys: [...d.keys.slice(0, at), k, ...d.keys.slice(at)] })));
      say(`“${k.name}” could not be ${k.kind === "oauth" ? "disconnected" : "revoked"}. Please try again.`, true);
    } finally {
      pending.current--;
    }
  }

  async function changeLimit(k: AccessKey, value: string) {
    const dailyLimit = value === "none" ? null : Number(value);
    const set = (limit: number | null) => setData((d) => ({ ...d, keys: d.keys.map((x) => (x.id === k.id ? { ...x, dailyLimit: limit } : x)) }));
    pending.current++;
    set(dailyLimit);
    try {
      const res = await fetch(`/api/keys/${k.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ dailyLimit }) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      say(dailyLimit === null ? `“${k.name}” now has no daily limit.` : `“${k.name}” may now spend ${dailyLimit.toLocaleString("en-US")} Credits in 24 hours.`);
    } catch {
      set(k.dailyLimit);
      say(`The limit of “${k.name}” could not be saved.`, true);
    } finally {
      pending.current--;
    }
  }

  function created(key: string, view: ApiKeyView) {
    setFresh({ id: view.id, key });
    setAdded(view.id);
    setData((d) => ({ ...d, keys: [{ ...view, spent24h: 0 }, ...d.keys.filter((x) => x.id !== view.id)] }));
  }

  function scrollReel(dir: 1 | -1) {
    const el = reel.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  return (
    <div className={`studio ac ${className}`}>
      <section className="ac-hero" aria-labelledby="ac-title">
        <div className="ac-hero__copy">
          <div className="ac-hero__top">
            <p className="ac-kicker">API &amp; MCP</p>
            <p className="ac-chip">
              <i className="ac-live" aria-hidden="true" />
              MCP server online<span aria-hidden="true">·</span>{TOOL_CARDS.length} Tools<span aria-hidden="true">·</span>OAuth 2.1
            </p>
          </div>
          <h1 id="ac-title">Tevyon, straight from your agent.</h1>
          <p className="ac-hero__sub">
            Claude, Cursor and the CLI create images and videos through the same job API as the studio. The price is fixed before every job
            and charged to your Credits.
          </p>
          <div className="ac-endpoint">
            <span className="ac-endpoint__tag">MCP</span>
            <code>{endpoint}</code>
            <CopyButton text={endpoint} label="Copy MCP address" />
          </div>
        </div>
      </section>

      <div className="ac-grid">
        <section className="ac-panel ac-access" aria-labelledby="ac-access-title">
          <header className="ac-panel__head">
            <div>
              <h2 id="ac-access-title">Access <span className="ac-count">{keys.length}</span></h2>
              <p>Keys and connected apps act for your account. Each has its own daily limit and can be revoked on its own.</p>
            </div>
            <button type="button" className="ac-btn ac-btn--primary" onClick={() => setDialog(true)} ref={newKey}>
              <Plus aria-hidden="true" />New key
            </button>
          </header>
          {keys.length === 0 ? (
            <div className="ac-empty">
              <p className="ac-empty__title">No access yet</p>
              <p>Connect Claude Code with the command on the right, no key needed. For scripts and servers, create a key here.</p>
            </div>
          ) : (
            <div className="ac-keytable">
              <div className="ac-keys__head" aria-hidden="true">
                <span>Access</span>
                <span>Last 24 h</span>
                <span>Daily limit</span>
              </div>
              <ul className="ac-keys">
                {keys.map((k) => (
                  <KeyRow
                    key={k.id}
                    k={k}
                    now={now}
                    armed={armed === k.id}
                    isNew={added === k.id}
                    onArm={(on) => setArmed((a) => (on ? k.id : a === k.id ? null : a))}
                    onRevoke={() => void revoke(k)}
                    onLimit={(v) => void changeLimit(k, v)}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="ac-panel ac-connect-panel" aria-labelledby="ac-connect-title">
          <header className="ac-panel__head">
            <div>
              <h2 id="ac-connect-title">Connect</h2>
              <p>Sign in through the browser with OAuth, no key needed. Or use a key where there is no browser.</p>
            </div>
          </header>
          <ConnectTabs origin={origin} keys={keys} freshKey={fresh?.key} />
        </section>

      </div>

      <section className="ac-section" aria-labelledby="ac-activity-title">
        <header className="ac-section__head">
          <div>
            <h2 id="ac-activity-title">Activity</h2>
            <p>What agents, the CLI and the API started recently, with access and price.</p>
          </div>
          {activity.length > 3 && (
            <div className="ac-section__nav">
              <button type="button" className="ac-iconbtn" onClick={() => scrollReel(-1)} aria-label="Scroll back"><ArrowLeft /></button>
              <button type="button" className="ac-iconbtn" onClick={() => scrollReel(1)} aria-label="Scroll forward"><ArrowRight /></button>
            </div>
          )}
        </header>
        {activity.length === 0 ? (
          <div className="ac-empty ac-empty--row">
            <p className="ac-empty__title">Nothing from agents yet</p>
            <p>As soon as Claude, Cursor or the CLI create something, it shows up here. Your studio jobs are under <a href="/assets">Assets <ArrowUpRight aria-hidden="true" /></a></p>
          </div>
        ) : (
          <ol className="ac-reel" ref={reel}>
            {activity.map((a) => <ActivityCard key={a.id} a={a} />)}
          </ol>
        )}
      </section>

      <section className="ac-section" aria-labelledby="ac-tools-title">
        <header className="ac-section__head">
          <div>
            <h2 id="ac-tools-title">Tools <span className="ac-count">{TOOL_CARDS.length}</span></h2>
            <p>What an agent can do through the MCP server. The same models, prices and rules as in the studio.</p>
          </div>
        </header>
        <ul className="ac-tools">
          {TOOL_CARDS.map((t) => (
            <li key={t.name} className="ac-tool">
              <code className="ac-tool__name">{t.name}</code>
              <p>{t.text}</p>
              <span className="ac-effect" data-effect={t.effect}>{EFFECT_LABEL[t.effect]}</span>
            </li>
          ))}
        </ul>
      </section>


      <KeyDialog open={dialog} origin={origin} onClose={() => setDialog(false)} onCreated={created} />
      <div className="ac-toast" popover="manual" ref={toastEl} data-error={toast?.error || undefined} aria-hidden="true">
        {toast?.error ? <CircleAlert /> : <Check />}
        {toast?.text}
      </div>
      <p className="ac-sr" role="status">{toast?.text}</p>
    </div>
  );
}
