import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DEFAULT_DAILY_LIMIT } from "@/core/api-keys";
import { currentAccount } from "@/server/account";
import { consentToken, pageOrigin } from "@/server/consent";
import { oauth } from "@/server/keys";
import "../../login/login.css";
import "../oauth.css";

export const metadata: Metadata = { title: "Zugriff erlauben – Tevyon", robots: { index: false, follow: false } };

/** The parameters of an authorization request that the decision form carries back unchanged. */
const FIELDS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

/** Where the code goes, in words: a website, or an app on this device (loopback or app scheme). */
function destination(uri: string): { where: string; note: string } {
  const u = new URL(uri);
  if (u.protocol === "https:") return { where: u.host, note: "Die Website erhält den Zugang." };
  if (u.protocol === "http:") return { where: u.host, note: "Eine App auf diesem Gerät erhält den Zugang, zum Beispiel Claude Code." };
  return { where: `${u.protocol}//${u.host}`, note: "Eine installierte App auf diesem Gerät erhält den Zugang." };
}

/** OAuth consent: an app (claude.ai, Claude Code, Cursor …) asks to act for the signed-in account. */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string") params[k] = value;
  }
  const account = await currentAccount();
  if (!account || account.via !== "session") redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(params)}`)}`);

  const origin = await pageOrigin();
  const check = await oauth().authorizeRequest(params, { issuer: origin, resource: `${origin}/api/mcp` });
  if (!check.ok && "redirect" in check) redirect(check.redirect);

  if (!check.ok) {
    return (
      <main className="grant">
        <section className="auth grant__card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="auth__mark" src="/favicon.svg" alt="" />
          <div className="auth__step">
            <p className="grant__eyebrow">Zugriff nicht möglich</p>
            <h1 className="auth__title grant__title">Diese Anfrage kann Tevyon nicht annehmen</h1>
            <p className="auth__lead">{check.error === "invalid_client" ? "Die App ist bei Tevyon nicht registriert." : "Die Rücksprungadresse gehört nicht zu dieser App."} Verbinde die App neu und versuche es noch einmal.</p>
          </div>
        </section>
      </main>
    );
  }

  const req = check.request;
  const target = destination(req.redirectUri);
  return (
    <main className="grant">
      <section className="auth grant__card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="auth__mark" src="/favicon.svg" alt="" />
        <div className="auth__step">
          <p className="grant__eyebrow">Zugriff erlauben</p>
          <h1 className="auth__title grant__title">«{req.clientName}» möchte mit deinem Tevyon-Konto arbeiten</h1>
          <p className="auth__lead">Angemeldet als <strong>{account.email ?? "dein Konto"}</strong>.</p>
          <div className="grant__target">
            <span>Der Zugang geht an</span>
            <strong>{target.where}</strong>
            <em>{target.note} Den Namen «{req.clientName}» gibt sich die App selbst.</em>
          </div>
          <ul className="grant__list">
            <li>Modelle, Preise und deine Credits sehen</li>
            <li>Bilder und Videos erstellen. Jeder Job bucht Credits von deinem Konto, höchstens {DEFAULT_DAILY_LIMIT} pro Tag. Das Limit kannst du unter «API & MCP» ändern.</li>
            <li>Deine Jobs, ihre Ergebnisse und deinen Kontoauszug lesen</li>
          </ul>
          <form className="grant__actions" method="post" action="/oauth/authorize/decide">
            {FIELDS.map((f) => (params[f] === undefined ? null : <input key={f} type="hidden" name={f} value={params[f]} />))}
            <input type="hidden" name="csrf" value={consentToken(account.id, req)} />
            <button className="auth__button grant__deny" type="submit" name="decision" value="deny">Ablehnen</button>
            <button className="auth__button grant__allow" type="submit" name="decision" value="allow">Erlauben</button>
          </form>
          <p className="auth__hint">Erlaube nur Apps, denen du vertraust. Trennen kannst du jederzeit unter Konto → «API & MCP».</p>
        </div>
      </section>
    </main>
  );
}
