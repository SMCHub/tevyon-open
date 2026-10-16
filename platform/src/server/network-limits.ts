import { createHmac } from "node:crypto";
import type { RateLimiter, RateRule } from "../core/rate-limit";
import { clientAddress } from "./oauth-limits";

const DAY_MS = 86_400_000;

/**
 * What accounts without a purchase get for free, per 24 hours (review 15.10.2026, abuse). The login code proves each
 * mailbox, but one person can still open many accounts. A network is no key for a person: a class, an office or an
 * event shares one address, IPv6 included (one /64 per network); so the network limits only brake scripts
 *. The tighter key is the mail domain: an own domain
 * can catch any number of addresses, the large providers cannot (core/welcome.ts isMassMailProvider). Accounts that
 * bought credits are never counted.
 */
export const NETWORK_LIMITS: Record<"welcome" | "welcomeDomain" | "directorFree", RateRule> = {
  /** New accounts per network that get their welcome credits; the others get them on a later visit. */
  welcome: { limit: 20, windowMs: DAY_MS },
  /** New accounts per own mail domain (not a large provider) that get their welcome credits. */
  welcomeDomain: { limit: 5, windowMs: DAY_MS },
  /** Director and Marketing Agent turns on the free daily budget, per network. */
  directorFree: { limit: 200, windowMs: DAY_MS },
};

/** Any value (an address, a mail domain) as a key for the counters: an HMAC with the server secret and a purpose. */
export function limitKey(purpose: string, value: string, secret = process.env.MEDIA_LINK_SECRET): string | undefined {
  if (!secret) return undefined;
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest("base64url").slice(0, 22);
}

/**
 * The caller's network as a key: the address the platform saw (IPv6 per /64, src/server/oauth-limits.ts) as an HMAC
 * with the server secret, so the counters (rate_limits, gone after their day) never hold an address and cannot be
 * matched to one by trying them all. Undefined without an address (local dev) or a secret: then nothing is counted.
 */
export function networkKey(headers: Pick<Headers, "get">, secret = process.env.MEDIA_LINK_SECRET): string | undefined {
  const address = clientAddress(headers);
  return address === "unknown" ? undefined : limitKey("network", address, secret);
}

/**
 * The network to count a request against, by how it came in: the Studio and API keys come from the user's own machine
 * or server. OAuth connections are left out: claude.ai calls from its own servers, so every user there would share
 * one address. Those accounts still have their own daily budget.
 */
export function countedNetwork(via: "session" | "api_key" | "key" | "oauth", headers: Pick<Headers, "get">): string | undefined {
  return via === "oauth" ? undefined : networkKey(headers);
}

/** Counts one use for the key (a network, a mail domain); true while its share for the day is left. */
export function createNetworkLimits(limiter: RateLimiter) {
  return async (key: string, what: keyof typeof NETWORK_LIMITS): Promise<boolean> =>
    (await limiter.hit(`${what}:${what === "welcomeDomain" ? "dom" : "net"}:${key}`, NETWORK_LIMITS[what])).ok;
}
