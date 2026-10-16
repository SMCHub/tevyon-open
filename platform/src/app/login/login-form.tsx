"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { supabaseBrowser } from "@/lib/supabase-browser";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;

type Step = "email" | "code" | "done";

function friendly(message: string) {
  if (/rate|too many|seconds/i.test(message)) return "Zu viele Versuche. Bitte warte kurz und versuche es erneut.";
  if (/expired|invalid|token/i.test(message)) return "Der Code stimmt nicht oder ist abgelaufen.";
  if (/email/i.test(message)) return "Diese E-Mail-Adresse können wir nicht verwenden.";
  return "Das hat nicht geklappt. Bitte versuche es erneut.";
}

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if (step === "code") boxes.current[0]?.focus();
  }, [step]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) return setError(friendly(error.message));
    setDigits(Array(CODE_LENGTH).fill(""));
    setStep("code");
    setWait(RESEND_SECONDS);
  }

  async function verify(code: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
    if (error) {
      setBusy(false);
      setError(friendly(error.message));
      setDigits(Array(CODE_LENGTH).fill(""));
      boxes.current[0]?.focus();
      return;
    }
    setStep("done");
    // Back to where the login was needed (OAuth consent, CLI login), else to the Studio.
    router.replace(safeNext(new URLSearchParams(window.location.search).get("next")) ?? "/");
    router.refresh();
  }

  function fill(from: number, text: string) {
    const clean = text.replace(/\D/g, "");
    if (!clean) return;
    const next = [...digits];
    for (let i = 0; i < clean.length && from + i < CODE_LENGTH; i++) next[from + i] = clean[i]!;
    setDigits(next);
    const filled = next.findIndex((d) => !d);
    boxes.current[filled === -1 ? CODE_LENGTH - 1 : filled]?.focus();
    if (next.every(Boolean)) verify(next.join(""));
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      const next = [...digits];
      next[i - 1] = "";
      setDigits(next);
      boxes.current[i - 1]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && i > 0) boxes.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) boxes.current[i + 1]?.focus();
  }

  return (
    <div className="auth" data-step={step}>
      {step === "email" && (
        <form className="auth__step" onSubmit={sendCode} noValidate>
          <h1 className="auth__title">Anmelden</h1>
          <p className="auth__lead">Per Code an deine E-Mail, ohne Passwort. Neu hier? Dein Konto entsteht dabei.</p>
          <label className="auth__field">
            <span className="auth__label">E-Mail</span>
            <input
              className="auth__input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="du@studio.ch"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "auth-error" : undefined}
            />
          </label>
          <button className="auth__go" type="submit" disabled={busy}>
            <span>{busy ? "Code wird gesendet …" : "Code senden"}</span>
            {busy ? <span className="auth__spinner" aria-hidden="true" /> : <ArrowRight className="auth__arrow" aria-hidden="true" />}
          </button>
          {error && <p className="auth__error" id="auth-error" role="alert">{error}</p>}
          <button
            type="button"
            className="auth__link"
            onClick={() => {
              if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Bitte zuerst deine E-Mail-Adresse eingeben.");
              setError(null);
              setDigits(Array(CODE_LENGTH).fill(""));
              setStep("code");
            }}
          >
            Ich habe schon einen Code
          </button>
        </form>
      )}

      {step !== "email" && (
        <div className="auth__step">
          <h1 className="auth__title">{step === "done" ? "Angemeldet" : "Code"}</h1>
          <p className="auth__lead">
            {step === "done" ? "Dein Studio wird geladen …" : <>{CODE_LENGTH} Ziffern, geschickt an <strong>{email.trim()}</strong>.</>}
          </p>
          <div className="otp" role="group" aria-label={`${CODE_LENGTH}-stelliger Code`}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  boxes.current[i] = el;
                }}
                className="otp__box"
                value={d}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                maxLength={CODE_LENGTH}
                aria-label={`Ziffer ${i + 1}`}
                disabled={busy || step === "done"}
                onChange={(e) => fill(i, e.target.value.slice(-CODE_LENGTH))}
                onPaste={(e) => {
                  e.preventDefault();
                  fill(0, e.clipboardData.getData("text"));
                }}
                onKeyDown={(e) => onKey(i, e)}
                onFocus={(e) => e.target.select()}
              />
            ))}
          </div>
          {busy && step === "code" && <p className="auth__hint"><span className="auth__spinner" aria-hidden="true" /> Code wird geprüft …</p>}
          {error && <p className="auth__error" role="alert">{error}</p>}
          {step === "code" && (
            <div className="auth__links">
              <button type="button" className="auth__link" disabled={wait > 0 || busy} onClick={() => sendCode()}>
                {wait > 0 ? `Neuer Code in ${wait} s` : "Neuen Code senden"}
              </button>
              <button type="button" className="auth__link" onClick={() => { setStep("email"); setError(null); }}>
                Andere E-Mail
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
