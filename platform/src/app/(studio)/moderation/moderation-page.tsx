"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, EyeOff, RotateCcw, ShieldCheck } from "lucide-react";
import type { QueueCreation, QueueProfile, QueueReport, ReportReason } from "@/core/community";
import { Avatar, REASONS, Toast } from "@/components/studio/community";
import { PreviewButton, usePreview } from "@/components/studio/media-preview";

type Queue = { creations: QueueCreation[]; profiles: QueueProfile[] };
type Tab = "creations" | "profiles";
type Target = { kind: "creation"; id: string } | { kind: "profile"; id: string };
type Action = "hide" | "unhide" | "dismiss";

const WHEN = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const LABEL = Object.fromEntries(REASONS.map((r) => [r.id, r.label])) as Record<ReportReason, string>;
const STATE: Record<QueueCreation["state"] | QueueProfile["state"], string> = {
  public: "Öffentlich", private: "Wieder privat", visible: "Sichtbar", hidden: "Ausgeblendet",
};
const DONE: Record<Action, string> = { hide: "Ausgeblendet. Der Urheber liest den Grund.", unhide: "Wiederhergestellt.", dismiss: "Erledigt: bleibt sichtbar." };

/**
 * What waits for the operator: creations and profiles with reports since the last review, or hidden, newest decision
 * first. Hide (with a reason its owner reads), restore, or settle the reports and leave it up. Never who reported.
 */
export function ModerationPage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("creations");
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/moderation", { cache: "no-store" });
      const d = (await r.json().catch(() => null)) as ({ ok?: boolean } & Queue) | null;
      if (!r.ok || !d?.ok) return setFailed(true);
      setFailed(false);
      setQueue({ creations: d.creations, profiles: d.profiles });
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(target: Target, action: Action, reason = ""): Promise<boolean> {
    const r = await fetch("/api/moderation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: target.kind, id: target.id, action, reason }),
    }).catch(() => null);
    const d = r ? ((await r.json().catch(() => null)) as { ok?: boolean } | null) : null;
    if (!d?.ok) {
      setNote("Das liess sich nicht speichern. Lade die Seite neu und versuch es noch einmal.");
      return false;
    }
    setNote(DONE[action]);
    await load();
    return true;
  }

  const count = { creations: queue?.creations.length ?? 0, profiles: queue?.profiles.length ?? 0 };
  return (
    <div className="studio cm cm-page md">
      <header className="cm-head">
        <div className="cm-head__copy">
          <span className="cm-kicker">Moderation</span>
          <h1>Meldungen und Ausgeblendetes</h1>
          <p className="cm-head__sub">
            Was gemeldet wurde, seit du zuletzt entschieden hast, und was ausgeblendet ist. Wer gemeldet hat, steht hier nie.
          </p>
        </div>
      </header>

      <div className="cm-bar">
        <div className="cm-tabs" role="tablist" aria-label="Art">
          {(["creations", "profiles"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className="cm-tab" onClick={() => setTab(t)}>
              {t === "creations" ? "Kreationen" : "Profile"}
              <span className="cm-tab__n">{queue ? count[t] : ""}</span>
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <p className="cm-note" role="alert">Die Warteschlange ist gerade nicht erreichbar. Lade die Seite gleich noch einmal.</p>
      ) : !queue ? (
        <p className="cm-note" role="status">Lade die Warteschlange …</p>
      ) : count[tab] === 0 ? (
        <div className="cm-empty">
          <ShieldCheck aria-hidden="true" />
          <strong>Nichts offen</strong>
          <p>{tab === "creations" ? "Keine gemeldeten oder ausgeblendeten Kreationen." : "Keine gemeldeten oder ausgeblendeten Profile."}</p>
        </div>
      ) : (
        <ul className="md-list">
          {tab === "creations"
            ? queue.creations.map((c) => <CreationCase key={c.jobId} c={c} onDecide={decide} />)
            : queue.profiles.map((p) => <ProfileCase key={p.handle} p={p} onDecide={decide} />)}
        </ul>
      )}
      {note && <Toast text={note} onDone={() => setNote(null)} />}
    </div>
  );
}

type Decide = (target: Target, action: Action, reason?: string) => Promise<boolean>;

function CreationCase({ c, onDecide }: { c: QueueCreation; onDecide: Decide }) {
  const preview = usePreview();
  const open = () =>
    preview.openEntries([{
      url: c.media.url, kind: c.kind, chip: "Moderation", title: c.handle ? `@${c.handle}` : "Kreation",
      text: c.state === "hidden" ? `Ausgeblendet: ${c.reason === "reports" || !c.reason ? "nach Meldungen" : c.reason}` : STATE[c.state],
      facts: c.reports.map((r) => LABEL[r.reason]),
    }]);
  return (
    <li className="md-case">
      <div className="md-case__media">
        {c.kind === "video" ? (
          <video src={`${c.media.url}#t=0.1`} muted playsInline preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.media.url} alt="" loading="lazy" decoding="async" />
        )}
        <PreviewButton onOpen={open} className="pv-open--sm" />
      </div>
      <CaseBody
        title={c.handle ? <Link href={`/profile/${c.handle}`}>@{c.handle}</Link> : <span>Profil gelöscht</span>}
        sub={c.kind === "video" ? "Video" : "Bild"}
        state={c.state}
        reason={c.reason}
        reports={c.reports}
      />
      <CaseActions target={{ kind: "creation", id: c.jobId }} hidden={c.state === "hidden"} reports={c.reports} onDecide={onDecide} />
    </li>
  );
}

function ProfileCase({ p, onDecide }: { p: QueueProfile; onDecide: Decide }) {
  return (
    <li className="md-case">
      <div className="md-case__media md-case__media--avatar">
        <Avatar name={p.name} src={p.avatar} size="lg" />
      </div>
      <CaseBody
        title={p.state === "hidden" ? <span>{p.name}</span> : <Link href={`/profile/${p.handle}`}>{p.name}</Link>}
        sub={`@${p.handle}`}
        state={p.state}
        reason={p.reason}
        reports={p.reports}
      />
      <CaseActions target={{ kind: "profile", id: p.handle }} hidden={p.state === "hidden"} reports={p.reports} onDecide={onDecide} />
    </li>
  );
}

function CaseBody({ title, sub, state, reason, reports }: {
  title: React.ReactNode; sub: string; state: keyof typeof STATE; reason?: string; reports: QueueReport[];
}) {
  return (
    <div className="md-case__body">
      <p className="md-case__title">{title}<span className="md-case__sub">{sub}</span></p>
      <p className="md-case__state">
        <span className="cm-badge" data-state={state}>{STATE[state]}</span>
        {state === "hidden" && <span>{reason === "reports" || !reason ? "nach Meldungen" : reason}</span>}
      </p>
      {reports.length > 0 && (
        <ul className="md-reports" aria-label="Meldungen">
          {reports.map((r, i) => (
            <li key={i}>
              <strong>{LABEL[r.reason]}</strong>
              {r.note && <span className="md-reports__note">«{r.note}»</span>}
              <time dateTime={new Date(r.at).toISOString()}>{WHEN.format(r.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Hidden: restore. Otherwise: settle the reports and leave it up, or hide it with a reason its owner reads (prefilled
 * with the most frequent report reason).
 */
function CaseActions({ target, hidden, reports, onDecide }: { target: Target; hidden: boolean; reports: QueueReport[]; onDecide: Decide }) {
  const [form, setForm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: Action, why = "") {
    setBusy(true);
    const ok = await onDecide(target, action, why);
    setBusy(false);
    if (ok) setForm(false);
  }
  function openForm() {
    const top = mostFrequent(reports);
    setReason(top ? LABEL[top] : "");
    setForm(true);
  }

  if (hidden) {
    return (
      <div className="md-case__actions">
        <button type="button" className="cm-btn cm-btn--sm" onClick={() => void run("unhide")} disabled={busy}><RotateCcw aria-hidden="true" /> Wiederherstellen</button>
      </div>
    );
  }
  if (form) {
    return (
      <form className="md-case__actions md-hide" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) void run("hide", reason.trim()); }}>
        <label className="cm-field">
          <span>Grund, den der Urheber liest</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required autoFocus />
        </label>
        <div className="md-hide__row">
          <button type="button" className="cm-btn cm-btn--quiet cm-btn--sm" onClick={() => setForm(false)}>Abbrechen</button>
          <button type="submit" className="cm-btn cm-btn--primary cm-btn--sm" disabled={busy || !reason.trim()}><EyeOff aria-hidden="true" /> Ausblenden</button>
        </div>
      </form>
    );
  }
  return (
    <div className="md-case__actions">
      <button type="button" className="cm-btn cm-btn--sm" onClick={openForm} disabled={busy}><EyeOff aria-hidden="true" /> Ausblenden</button>
      {reports.length > 0 && (
        <button type="button" className="cm-btn cm-btn--quiet cm-btn--sm" onClick={() => void run("dismiss")} disabled={busy}><Check aria-hidden="true" /> Erledigt</button>
      )}
    </div>
  );
}

function mostFrequent(reports: QueueReport[]): ReportReason | null {
  const n = new Map<ReportReason, number>();
  for (const r of reports) n.set(r.reason, (n.get(r.reason) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
