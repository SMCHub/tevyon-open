"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck, X } from "lucide-react";
import type { ApiKeyView } from "@/core/api-keys";
import { CodeBlock, CopyButton, maskKey } from "./console-parts";

const LIMITS: { value: number | null; label: string }[] = [
  { value: 100, label: "100" },
  { value: 300, label: "300" },
  { value: 1000, label: "1000" },
  { value: null, label: "Ohne" },
];

type Created = { key: string; view: ApiKeyView };

/**
 * Create a key in a modal dialog: name and daily limit, then the key once, hidden until revealed (it copies
 * either way), with the commands that use it. Escape or «Fertig» closes; the list refreshes behind it.
 */
export function KeyDialog({ open, origin, onClose, onCreated }: { open: boolean; origin: string; onClose(): void; onCreated(key: string, view: ApiKeyView): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("Claude Code");
  const [limit, setLimit] = useState<number | null>(300);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setCreated(null);
      setShown(false);
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, dailyLimit: limit }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === "too_many_keys" ? "Höchstens 20 aktive Zugänge. Widerrufe zuerst einen alten." : "Gib dem Schlüssel einen Namen mit 1 bis 60 Zeichen.");
        return;
      }
      setCreated(data as Created);
      onCreated((data as Created).key, (data as Created).view);
    } catch {
      setError("Der Schlüssel konnte nicht erstellt werden. Versuche es noch einmal.");
    } finally {
      setBusy(false);
    }
  }

  /** Arrow keys move the choice, as in any radio group. */
  function moveLimit(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = (LIMITS.findIndex((l) => l.value === limit) + step + LIMITS.length) % LIMITS.length;
    setLimit(LIMITS[i]!.value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[i]?.focus();
  }

  const masked = created ? maskKey(created.key) : "";

  return (
    <dialog className="ac-dialog" ref={ref} onClose={onClose} aria-labelledby="ac-dialog-title">
      <div className="ac-dialog__head">
        <span className="ac-dialog__icon" aria-hidden="true">{created ? <ShieldCheck /> : <KeyRound />}</span>
        <h2 id="ac-dialog-title">{created ? "Schlüssel erstellt" : "Neuer API-Schlüssel"}</h2>
        <button type="button" className="ac-iconbtn" onClick={onClose} aria-label="Schliessen"><X /></button>
      </div>

      {!created ? (
        <form className="ac-dialog__form" onSubmit={create}>
          <label className="ac-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus placeholder="z. B. Claude Code auf dem Laptop" />
          </label>
          <fieldset className="ac-field">
            <legend>Tageslimit in Credits</legend>
            <div className="ac-segment" role="radiogroup" aria-label="Tageslimit" onKeyDown={moveLimit}>
              {LIMITS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  role="radio"
                  aria-checked={limit === l.value}
                  tabIndex={limit === l.value ? 0 : -1}
                  className="ac-segment__opt"
                  onClick={() => setLimit(l.value)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <small>Höchstens so viele Credits darf der Schlüssel in 24 Stunden ausgeben. Änderbar.</small>
          </fieldset>
          {error && <p className="ac-error" role="alert">{error}</p>}
          <div className="ac-dialog__actions">
            <button type="button" className="ac-btn ac-btn--quiet" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="ac-btn ac-btn--primary" disabled={busy}>{busy ? "Erstelle …" : "Schlüssel erstellen"}</button>
          </div>
        </form>
      ) : (
        <div className="ac-dialog__form">
          <p className="ac-dialog__lead">«{created.view.name}» ist bereit. Der Schlüssel ist <strong>nur jetzt</strong> sichtbar. Bewahre ihn wie ein Passwort auf.</p>
          <div className="ac-secret">
            <code aria-label={shown ? "API-Schlüssel" : "API-Schlüssel, verdeckt"}>{shown ? created.key : masked}</code>
            <button type="button" className="ac-iconbtn" onClick={() => setShown((s) => !s)} aria-label={shown ? "Schlüssel verdecken" : "Schlüssel anzeigen"}>
              {shown ? <EyeOff /> : <Eye />}
            </button>
            <CopyButton text={created.key} label="Schlüssel kopieren" />
          </div>
          <p className="ac-dialog__sub">Gleich verwenden</p>
          <CodeBlock
            code={`claude mcp add --transport http --scope user tevyon ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${shown ? created.key : masked}"`}
            copy={`claude mcp add --transport http --scope user tevyon ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${created.key}"`}
            label="Befehl für Claude Code kopieren"
          />
          <CodeBlock code="tevyon login --with-key" label="CLI-Befehl kopieren" />
          <div className="ac-dialog__actions">
            <button type="button" className="ac-btn ac-btn--primary" onClick={onClose}>Fertig</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
