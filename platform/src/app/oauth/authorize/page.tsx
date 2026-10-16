import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DEFAULT_DAILY_LIMIT } from "@/core/api-keys";
import { currentAccount } from "@/server/account";
import { consentToken, pageOrigin } from "@/server/consent";
import { oauth } from "@/server/keys";
import "../../login/login.css";
import "../oauth.css";

export const metadata: Metadata = { title: "Allow access – Tevyon", robots: { index: false, follow: false } };

/** The parameters of an authorization request that the decision form carries back unchanged. */
const FIELDS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

/** Where the code goes, in words: a website, or an app on this device (loopback or app scheme). */
function destination(uri: string): { where: string; note: string } {
  const u = new URL(uri);
  if (u.protocol === "https:") return { where: u.host, note: "The website gets access." };
  if (u.protocol === "http:") return { where: u.host, note: "An app on this device gets access, for example Claude Code." };
  return { where: `${u.protocol}//${u.host}`, note: "An installed app on this device gets access." };
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
            <p className="grant__eyebrow">Access not possible</p>
            <h1 className="auth__title grant__title">Tevyon cannot accept this request</h1>
            <p className="auth__lead">{check.error === "invalid_client" ? "The app is not registered with Tevyon." : "The redirect address does not belong to this app."} Reconnect the app and try again.</p>
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
          <p className="grant__eyebrow">Allow access</p>
          <h1 className="auth__title grant__title">“{req.clientName}” wants to work with your Tevyon account</h1>
          <p className="auth__lead">Signed in as <strong>{account.email ?? "your account"}</strong>.</p>
          <div className="grant__target">
            <span>Access goes to</span>
            <strong>{target.where}</strong>
            <em>{target.note} The app chose the name “{req.clientName}” itself.</em>
          </div>
          <ul className="grant__list">
            <li>See models, prices and your Credits</li>
            <li>Create images and videos. Every job spends Credits from your account, at most {DEFAULT_DAILY_LIMIT} per day. You can change the limit under “API & MCP”.</li>
            <li>Read your jobs, their results and your statement</li>
          </ul>
          <form className="grant__actions" method="post" action="/oauth/authorize/decide">
            {FIELDS.map((f) => (params[f] === undefined ? null : <input key={f} type="hidden" name={f} value={params[f]} />))}
            <input type="hidden" name="csrf" value={consentToken(account.id, req)} />
            <button className="auth__button grant__deny" type="submit" name="decision" value="deny">Decline</button>
            <button className="auth__button grant__allow" type="submit" name="decision" value="allow">Allow</button>
          </form>
          <p className="auth__hint">Only allow apps you trust. You can disconnect any time under Account → “API & MCP”.</p>
        </div>
      </section>
    </main>
  );
}
