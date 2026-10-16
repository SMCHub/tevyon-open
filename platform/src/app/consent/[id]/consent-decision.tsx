"use client";

import { useState } from "react";
import type { ConsentState } from "@/core/consent";

const DONE: Record<Exclude<ConsentState, "pending">, string> = {
  confirmed: "Confirmed. The agent can now start the job once. You can close this window.",
  declined: "Declined. No job starts with these images.",
  used: "This consent was already used for a job.",
  expired: "This request has expired. The agent can send a new one.",
};

/** "Decline" and "Confirm": the person's decision, sent from this page only (POST /api/consent/{id}). */
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
    setError("That could not be saved. Reload the page and try again.");
  }

  if (state !== "pending") return <p className="consent__done" role="status">{DONE[state]}</p>;
  return (
    <>
      <div className="grant__actions">
        <button className="auth__button grant__deny" type="button" onClick={() => void decide("decline")} disabled={busy}>Decline</button>
        <button className="auth__button grant__allow" type="button" onClick={() => void decide("confirm")} disabled={busy}>Confirm</button>
      </div>
      {error && <p className="auth__error" role="alert">{error}</p>}
    </>
  );
}
