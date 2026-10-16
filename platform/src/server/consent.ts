import { createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import type { AuthRequest } from "@/core/oauth";

/**
 * Protection for the two decisions a signed-in user makes for an app: OAuth consent and the CLI's device login.
 * A form token binds the decision to the account and to exactly this request (HMAC with a purpose prefix, so it can
 * never be mistaken for a media link signature that uses the same secret). The routes also check the Origin.
 */
function secret(): string {
  const s = process.env.MEDIA_LINK_SECRET;
  if (!s) throw new Error("MEDIA_LINK_SECRET is missing (platform/.env.local)");
  return s;
}

const mac = (parts: string[]) => createHmac("sha256", secret()).update(parts.join("|")).digest("base64url");

function same(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const consentToken = (accountId: string, r: AuthRequest) =>
  mac(["oauth-consent", accountId, r.clientId, r.redirectUri, r.challenge, r.state ?? "", r.scope, r.resource ?? ""]);
export const checkConsentToken = (token: string | undefined, accountId: string, r: AuthRequest) => same(token, consentToken(accountId, r));

export const deviceToken = (accountId: string, userCode: string) => mac(["device-login", accountId, userCode.toUpperCase()]);
export const checkDeviceToken = (token: string | undefined, accountId: string, userCode: string) => same(token, deviceToken(accountId, userCode));

/** A form post from our own pages: the browser's Origin is this site (or absent outside browsers). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

/** The origin of the current page request (server components have no Request). PUBLIC_BASE_URL wins behind proxies. */
export async function pageOrigin(): Promise<string> {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
