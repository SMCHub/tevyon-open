import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "../core/rate-limit";
import { clientAddress, createOAuthLimits, OAUTH_LIMITS } from "./oauth-limits";

const req = (headers: Record<string, string>) => new Request("https://app.tachyon.test/oauth/register", { method: "POST", headers });

describe("client address", () => {
  it("takes the address the platform saw, not what a client wrote further down the chain", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientAddress(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientAddress(new Headers())).toBe("unknown");
    // Some proxies append the port; every connection would otherwise be its own bucket.
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.7:51234" }))).toBe("203.0.113.7");
    expect(clientAddress(new Headers({ "x-real-ip": "[2001:db8:abcd:12::7]:443" }))).toBe("2001:db8:abcd:12::/64");
  });

  it("counts IPv6 per /64, because one machine gets a whole /64", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "2001:db8:abcd:12:1::7" }))).toBe("2001:db8:abcd:12::/64");
    expect(clientAddress(new Headers({ "x-real-ip": "2001:db8:abcd:12:ffff:ffff:ffff:1" }))).toBe("2001:db8:abcd:12::/64");
    expect(clientAddress(new Headers({ "x-real-ip": "2001:0DB8:ABCD:0012::1" }))).toBe("2001:db8:abcd:12::/64");
    expect(clientAddress(new Headers({ "x-real-ip": "::ffff:203.0.113.7" }))).toBe("203.0.113.7");
  });
});

describe("oauth limits", () => {
  it("lets one address register a handful of clients an hour, then asks it to wait; others go on", async () => {
    let t = Date.UTC(2026, 9, 13, 21);
    const limit = createOAuthLimits(createMemoryRateLimiter(() => t));
    const me = { "x-real-ip": "203.0.113.7" };
    for (let i = 0; i < OAUTH_LIMITS.register.perAddress.limit; i++) expect(await limit(req(me), "register")).toBeNull();
    expect(await limit(req(me), "register")).toEqual({ retryAfterSeconds: 3600 });
    expect(await limit(req({ "x-real-ip": "198.51.100.1" }), "register")).toBeNull();
    t += 3_600_000;
    expect(await limit(req(me), "register")).toBeNull();
  });

  it("caps everyone together, so spreading over many addresses does not fill the database", async () => {
    const limit = createOAuthLimits(createMemoryRateLimiter(() => Date.UTC(2026, 9, 13, 21)));
    const { total } = OAUTH_LIMITS.device;
    for (let i = 0; i < total.limit; i++) expect(await limit(req({ "x-real-ip": `10.0.${i >> 8}.${i & 255}` }), "device")).toBeNull();
    expect(await limit(req({ "x-real-ip": "198.51.100.99" }), "device")).not.toBeNull();
  });

  it("counts registration and device login apart", async () => {
    const limit = createOAuthLimits(createMemoryRateLimiter(() => Date.UTC(2026, 9, 13, 21)));
    const me = { "x-real-ip": "203.0.113.7" };
    for (let i = 0; i < OAUTH_LIMITS.register.perAddress.limit + 1; i++) await limit(req(me), "register");
    expect(await limit(req(me), "device")).toBeNull();
  });
});
