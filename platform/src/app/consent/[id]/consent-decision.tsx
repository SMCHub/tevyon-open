"use client";

import { useState } from "react";
import type { ConsentState } from "@/core/consent";

const DONE: Record<Exclude<ConsentState, "pending">, string> = {
  confirmed: "Bestätigt. Der Agent kann den Job jetzt einmal starten. Du kannst dieses Fenster schliessen.",
  declined: "Abgelehnt. Mit diesen Bildern startet kein Job.",
  used: "Diese Einwilligung wurde schon für einen Job verwendet.",
  expired: "Diese Anfrage ist abgelaufen. Der Agent kann eine neue stellen.",
};

/** «Ablehnen» and «Bestätigen»: the person's decision, sent from this page only (POST /api/consent/{id}). */
export function ConsentDecision({ id, state: initial }: { id: string; state: ConsentState }) {
  const [state, setState] = useState<ConsentState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "confirm" | "decline") {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/consent/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);
    const d = r ? ((await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null) : null;
    setBusy(false);
    if (d?.ok) return setState(action === "confirm" ? "confirmed" : "declined");
    if (d?.error === "expired" || d?.error === "used" || d?.error === "declined" || d?.error === "confirmed") return setState(d.error);
    setError("Das liess sich gerade nicht speichern. Lade die Seite neu und versuch es noch einmal.");
  }

  if (state !== "pending") return <p className="consent__done" role="status">{DONE[state]}</p>;
  return (
    <>
      <div className="grant__actions">
        <button className="auth__button grant__deny" type="button" onClick={() => void decide("decline")} disabled={busy}>Ablehnen</button>
        <button className="auth__button grant__allow" type="button" onClick={() => void decide("confirm")} disabled={busy}>Bestätigen</button>
      </div>
      {error && <p className="auth__error" role="alert">{error}</p>}
    </>
  );
}
