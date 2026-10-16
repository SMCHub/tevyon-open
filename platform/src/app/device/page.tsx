import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAccount } from "@/server/account";
import { deviceToken } from "@/server/consent";
import { oauth } from "@/server/keys";
import "../login/login.css";
import "../oauth/oauth.css";

export const metadata: Metadata = { title: "Sign in the CLI – Tevyon", robots: { index: false, follow: false } };

const ERRORS = {
  not_found: "Tevyon does not know this code. Check it in the terminal.",
  expired: "The code has expired. Run “tevyon login” again.",
  used: "This code was already used.",
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
        <span className="auth__label">Code from the terminal</span>
        <input className="auth__input" name="code" placeholder="WDJB-MJHT" autoComplete="one-time-code" autoCapitalize="characters" required aria-invalid={error ? true : undefined} />
      </label>
      {error && <p className="auth__error" role="alert">{error}</p>}
      <button className="auth__button grant__allow" type="submit">Continue</button>
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
      <Card eyebrow="Command line" title="The CLI is signed in">
        <span className="grant__done" aria-hidden="true">✓</span>
        <p className="auth__lead">You can return to the terminal. You find the CLI's key under Account → “API & MCP”.</p>
      </Card>
    );
  }
  if (done === "denied") {
    return (
      <Card eyebrow="Command line" title="Sign-in declined">
        <p className="auth__lead">The CLI gets no access. You can close this window.</p>
      </Card>
    );
  }
  if (!code) {
    return (
      <Card eyebrow="Command line" title="Sign in the CLI">
        <p className="auth__lead">Enter the code that “tevyon login” shows in the terminal.</p>
        <CodeForm />
      </Card>
    );
  }

  const look = await oauth().deviceLookup(code);
  if (!look.ok) {
    return (
      <Card eyebrow="Command line" title="Sign in the CLI">
        <CodeForm error={ERRORS[look.error]} />
      </Card>
    );
  }
  const { device } = look;
  return (
    <Card eyebrow="Command line" title={`Sign in ${device.clientName}${device.name ? ` on “${device.name}”` : ""}?`}>
      <p className="auth__lead">Signed in as <strong>{account.email ?? "your account"}</strong>. Does this code match the one in the terminal?</p>
      <div className="grant__code">{device.userCode}</div>
      <p className="auth__hint">The CLI gets its own API key with a limit of 300 Credits per day. You can revoke it any time under “API & MCP”.</p>
      <form className="grant__actions" method="post" action="/device/decide">
        <input type="hidden" name="code" value={device.userCode} />
        <input type="hidden" name="csrf" value={deviceToken(account.id, device.userCode)} />
        <button className="auth__button grant__deny" type="submit" name="decision" value="deny">Decline</button>
        <button className="auth__button grant__allow" type="submit" name="decision" value="allow">Confirm</button>
      </form>
    </Card>
  );
}
