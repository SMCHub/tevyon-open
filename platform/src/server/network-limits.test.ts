import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "../core/rate-limit";
import { NETWORK_LIMITS, createNetworkLimits, limitKey, networkKey } from "./network-limits";

const SECRET = "test-secret";
const from = (address: string) => new Headers({ "x-real-ip": address });

describe("caller's network", () => {
  it("is a key that never holds the address: one per IPv4 address, one per IPv6 /64", () => {
    const key = networkKey(from("203.0.113.7"), SECRET)!;
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(key).not.toContain("203");
    expect(networkKey(from("203.0.113.7"), SECRET)).toBe(key);
    expect(networkKey(from("203.0.113.8"), SECRET)).not.toBe(key);
    expect(networkKey(from("2001:db8:1:2::7"), SECRET)).toBe(networkKey(from("2001:db8:1:2:aaaa::1"), SECRET));
    expect(networkKey(from("2001:db8:1:3::7"), SECRET)).not.toBe(networkKey(from("2001:db8:1:2::7"), SECRET));
    // Another server secret, another key: the counters cannot be matched to addresses by trying them all.
    expect(networkKey(from("203.0.113.7"), "other")).not.toBe(key);
  });

  it("turns any other value (an e-mail domain) into a key the same way, apart from the network keys", () => {
    const key = limitKey("domain", "my-shop.ch", SECRET)!;
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(key).toBe(limitKey("domain", "my-shop.ch", SECRET));
    expect(key).not.toBe(limitKey("domain", "other-shop.ch", SECRET));
    expect(key).not.toBe(limitKey("network", "my-shop.ch", SECRET));
    expect(limitKey("domain", "my-shop.ch", undefined)).toBeUndefined();
  });

  it("is unknown without an address or a server secret, and then nothing is counted per network", () => {
    expect(networkKey(new Headers(), SECRET)).toBeUndefined();
    expect(networkKey(from("203.0.113.7"), undefined)).toBeUndefined();
  });

  it("gives each network and each own mail domain its share per day, separately for each kind", async () => {
    let clock = Date.UTC(2026, 9, 15, 12);
    const allow = createNetworkLimits(createMemoryRateLimiter(() => clock));
    for (let i = 0; i < NETWORK_LIMITS.welcome.limit; i++) expect(await allow("net-a", "welcome")).toBe(true);
    expect(await allow("net-a", "welcome")).toBe(false);
    expect(await allow("net-b", "welcome")).toBe(true);
    expect(await allow("net-a", "directorFree")).toBe(true);
    expect(await allow("net-a", "welcomeDomain")).toBe(true);
    clock += NETWORK_LIMITS.welcome.windowMs;
    expect(await allow("net-a", "welcome")).toBe(true);
  });

  it("is a brake for scripts, not for a class or an office on one network: a domain of its own is the tighter key", () => {
    expect(NETWORK_LIMITS.welcome.limit).toBeGreaterThanOrEqual(20);
    expect(NETWORK_LIMITS.directorFree.limit).toBeGreaterThanOrEqual(200);
    expect(NETWORK_LIMITS.welcomeDomain.limit).toBeLessThan(NETWORK_LIMITS.welcome.limit);
  });
});
