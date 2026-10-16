import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAccount } from "@/server/account";
import { deviceToken } from "@/server/consent";
import { oauth } from "@/server/keys";
import "../login/login.css";
import "../oauth/oauth.css";

export const metadata: Metadata = { title: "CLI anmelden – Tevyon", robots: { index: false, follow: false } };

const ERRORS = {
  not_found: "Diesen Code kennt Tevyon nicht. Prüfe ihn im Terminal.",
  expired: "Der Code ist abgelaufen. Starte «tevyon login» noch einmal.",
  used: "Dieser Code wurde schon verwendet.",
} as const;

function Card({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <main className="grant">
      <section className="auth grant__card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="auth__mark" src="/favicon.svg" alt="" />
        <div className="auth__step">
          <p className="grant__eyebrow">{eyebrow}</p>
          <h1 className="auth__title grant__title">{title}</h1>
          {children}
        </div>
      </section>
    </main>
  );
}

function CodeForm({ error }: { error?: string }) {
  return (
    <form className="grant__form" method="get" action="/device">
      <label className="auth__field">
        <span className="auth__label">Code aus dem Terminal</span>
        <input className="auth__input" name="code" placeholder="WDJB-MJHT" autoComplete="one-time-code" autoCapitalize="characters" required aria-invalid={error ? true : undefined} />
      </label>
      {error && <p className="auth__error" role="alert">{error}</p>}
      <button className="auth__button grant__allow" type="submit">Weiter</button>
    </form>
  );
}

/** The CLI's device login (RFC 8628): the signed-in user confirms the code that `tevyon login` shows. */
export default async function DevicePage({ searchParams }: PageProps<"/device">) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code.trim() : "";
  const done = typeof sp.done === "string" ? sp.done : "";
  const account = await currentAccount();
  if (!account || account.via !== "session") redirect(`/login?next=${encodeURIComponent(`/device${code ? `?code=${encodeURIComponent(code)}` : ""}`)}`);

  if (done === "allowed") {
    return (
      <Card eyebrow="Kommandozeile" title="Die CLI ist angemeldet">
        <span className="grant__done" aria-hidden="true">✓</span>
        <p className="auth__lead">Du kannst zum Terminal zurückkehren. Den Schlüssel der CLI findest du unter Konto → «API & MCP».</p>
      </Card>
    );
  }
  if (done === "denied") {
    return (
      <Card eyebrow="Kommandozeile" title="Anmeldung abgelehnt">
        <p className="auth__lead">Die CLI bekommt keinen Zugang. Du kannst dieses Fenster schliessen.</p>
      </Card>
    );
  }
  if (!code) {
    return (
      <Card eyebrow="Kommandozeile" title="CLI anmelden">
        <p className="auth__lead">Gib den Code ein, den «tevyon login» im Terminal zeigt.</p>
        <CodeForm />
      </Card>
    );
  }

  const look = await oauth().deviceLookup(code);
  if (!look.ok) {
    return (
      <Card eyebrow="Kommandozeile" title="CLI anmelden">
        <CodeForm error={ERRORS[look.error]} />
      </Card>
    );
  }
  const { device } = look;
  return (
    <Card eyebrow="Kommandozeile" title={`${device.clientName}${device.name ? ` auf «${device.name}»` : ""} anmelden?`}>
      <p className="auth__lead">Angemeldet als <strong>{account.email ?? "dein Konto"}</strong>. Stimmt dieser Code mit dem im Terminal überein?</p>
      <div className="grant__code">{device.userCode}</div>
      <p className="auth__hint">Die CLI bekommt einen eigenen API-Schlüssel mit einem Limit von 300 Credits pro Tag. Widerrufen kannst du ihn jederzeit unter «API & MCP».</p>
      <form className="grant__actions" method="post" action="/device/decide">
        <input type="hidden" name="code" value={device.userCode} />
        <input type="hidden" name="csrf" value={deviceToken(account.id, device.userCode)} />
        <button className="auth__button grant__deny" type="submit" name="decision" value="deny">Ablehnen</button>
        <button className="auth__button grant__allow" type="submit" name="decision" value="allow">Bestätigen</button>
      </form>
    </Card>
  );
}
