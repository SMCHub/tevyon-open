import { createHash } from "node:crypto";
import { grantSource } from "./credits";
import disposable from "./data/disposable-email-domains.json";
import type { JobRepository } from "./repository";

/**
 * Welcome credits once per mailbox. The Studio login is an e-mail code
 * (OTP), so every session already proves its mailbox; what is left to stop is one person collecting the credits with
 * many addresses: +tags and Gmail dots that reach one inbox, and throwaway domains.
 */
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const DISPOSABLE = new Set(disposable.domains.filter((d) => DOMAIN.test(d)));

/** The mailbox behind an address: lower case, without +tag; Gmail and Googlemail also without dots. */
export function mailbox(email: string): string | undefined {
  const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(email.trim().toLowerCase());
  if (!m) return undefined;
  let local = m[1]!.split("+")[0]!;
  let domain = m[2]!;
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local ? `${local}@${domain}` : undefined;
}

/**
 * The large mail providers: each address there is an account of its own, made with a phone number or a captcha. Any
 * other domain can catch every address at it (catch-all), many mailboxes for the price of one, so the welcome credits
 * per such domain and day are limited (src/server/network-limits.ts).
 */
const MASS_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.de", "hotmail.com", "hotmail.ch", "hotmail.de", "live.com", "live.de", "msn.com",
  "icloud.com", "me.com", "mac.com", "yahoo.com", "yahoo.de", "ymail.com", "aol.com", "gmx.ch", "gmx.de", "gmx.net", "gmx.at", "web.de",
  "t-online.de", "bluewin.ch", "sunrise.ch", "hispeed.ch", "proton.me", "protonmail.com", "pm.me",
]);

export function isMassMailProvider(email: string): boolean {
  const domain = /@([^@\s]+)$/.exec(email.trim().toLowerCase())?.[1];
  return domain !== undefined && MASS_MAIL.has(domain);
}

/** A throwaway domain (from the list in data/, source and date inside), its subdomains included. */
export function isDisposable(email: string): boolean {
  const parts = (email.split("@")[1] ?? "").toLowerCase().split(".");
  for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE.has(parts.slice(i).join("."))) return true;
  return false;
}

export type WelcomeResult = "granted" | "already" | "mailbox_used" | "disposable" | "anonymous" | "no_email" | "network_limit";

/**
 * Books the welcome credits for a signed-in account, once per mailbox: the grant ref is the hash of the mailbox, and a
 * ref exists only once across all accounts. Accounts welcomed under the old rule (ref welcome:<account>) are left alone.
 * gate: counts a grant about to happen against the caller's network and says whether its share for the day is left;
 * when not, the credits wait ("network_limit") and a later visit asks again.
 */
export async function welcome(
  repo: Pick<JobRepository, "grant" | "grants">, account: { id: string; email?: string; anonymous?: boolean }, credits: number,
  gate?: () => Promise<boolean>,
): Promise<WelcomeResult> {
  if (account.anonymous) return "anonymous";
  const box = account.email ? mailbox(account.email) : undefined;
  if (!box) return "no_email";
  if (isDisposable(box)) return "disposable";
  if ((await repo.grants(account.id)).some((g) => grantSource(g.ref) === "welcome")) return "already";
  if (gate && !(await gate())) return "network_limit";
  const ref = `welcome:${createHash("sha256").update(box).digest("hex")}`;
  await repo.grant(account.id, credits, ref);
  return (await repo.grants(account.id)).some((g) => g.ref === ref) ? "granted" : "mailbox_used";
}
