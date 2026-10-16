import { headers } from "next/headers";
import { isMassMailProvider, mailbox, welcome } from "@/core/welcome";
import { verifyBearer } from "./keys";
import { localAccount } from "./local-account";
import { createNetworkLimits, limitKey, networkKey } from "./network-limits";
import { rateLimiter } from "./rate-limits";
import { supabaseServer } from "./supabase";
import { runtime } from "./runtime";

/** Credits every new account starts with, once per mailbox. */
export const WELCOME_CREDITS = 100;
/** Accounts this instance has looked at, and when to look again: never, or in an hour while their network's share is used up. */
const welcomed = new Map<string, number>();
const RETRY_WELCOME_MS = 3_600_000;

/**
 * via: Studio login cookie, an API key (CLI, scripts) or an OAuth connection (claude.ai, Claude Code …).
 * All act on the same account and credits.
 * keyId: the key or connection the request came with, so jobs and the statement can say which one spent what.
 * dailyLimit: credits that key or connection may spend per 24 hours (null = no limit; never set for the Studio).
 */
export type Account = { id: string; email?: string; via: "session" | "api_key" | "oauth"; keyId?: string; dailyLimit?: number | null };

/**
 * The signed-in account, or null. A request with "Authorization: Bearer …" counts only by that token (API key or
 * OAuth access token), never by a cookie. Otherwise the Supabase session (JWT verified via getClaims); books the
 * welcome credits once.
 */
export async function currentAccount(): Promise<Account | null> {
  const authorization = (await headers()).get("authorization");
  if (authorization) {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
    const p = token ? await verifyBearer(token) : null;
    if (!p) return null;
    return { id: p.accountId, ...(p.email ? { email: p.email } : {}), via: p.kind === "oauth" ? "oauth" : "api_key", keyId: p.keyId, dailyLimit: p.dailyLimit };
  }

  const local = localAccount();
  const claims = local
    ? { sub: local.id, email: local.email, is_anonymous: false }
    : (await (await supabaseServer()).auth.getClaims()).data?.claims;
  if (!claims?.sub) return null;
  const account: Account = { id: claims.sub, ...(typeof claims.email === "string" ? { email: claims.email } : {}), via: "session" };
  if ((welcomed.get(account.id) ?? 0) <= Date.now()) {
    // Once per mailbox, never for throwaway domains or anonymous sessions; a few new accounts per own mail domain and
    // a script brake per network each day (src/core/welcome.ts, src/server/network-limits.ts).
    const network = networkKey(await headers());
    const own = account.email && !isMassMailProvider(account.email) ? mailbox(account.email)?.split("@")[1] : undefined;
    const domain = own ? limitKey("domain", own) : undefined;
    const allow = createNetworkLimits(rateLimiter());
    const gate = network || domain
      ? async () => (!domain || (await allow(domain, "welcomeDomain"))) && (!network || (await allow(network, "welcome")))
      : undefined;
    const result = await welcome((await runtime()).repo, { ...account, anonymous: claims.is_anonymous === true }, WELCOME_CREDITS, gate);
    welcomed.set(account.id, result === "network_limit" ? Date.now() + RETRY_WELCOME_MS : Infinity);
    // Local mode: credits are only bookkeeping here (the real price is paid at Comfy), so the one local account starts
    // with enough to try every model; LOCAL_CREDITS changes the amount (booked once).
    if (local) await (await runtime()).repo.grant(account.id, Number(process.env.LOCAL_CREDITS) || 2_000, "local:start");
  }
  return account;
}

export const unauthorized = () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
