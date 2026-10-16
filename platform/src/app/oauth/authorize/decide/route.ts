import { currentAccount } from "@/server/account";
import { checkConsentToken, sameOrigin } from "@/server/consent";
import { oauth } from "@/server/keys";
import { publicBase } from "@/server/media-links";

/**
 * The consent decision. Never trusts the hidden fields alone: the request is checked again, the form token must
 * match this account and exactly this request, and the post must come from our own page. Answers with 303 to the
 * app's redirect URI (code, or error=access_denied), always with state and iss.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const account = await currentAccount();
  if (!account || account.via !== "session") return new Response("Please sign in to Tevyon first.", { status: 401 });
  const form = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const origin = publicBase(req);
  const check = await oauth().authorizeRequest(form, { issuer: origin, resource: `${origin}/api/mcp` });
  if (!check.ok) {
    return "redirect" in check ? new Response(null, { status: 303, headers: { location: check.redirect } }) : new Response(check.description, { status: 400 });
  }
  if (!checkConsentToken(form.csrf, account.id, check.request)) return new Response("Forbidden", { status: 403 });
  const location = form.decision === "allow"
    ? await oauth().approve(check.request, { id: account.id, ...(account.email ? { email: account.email } : {}) }, { issuer: origin })
    : oauth().deny(check.request, { issuer: origin });
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}
