import { describe, expect, it } from "vitest";
import { checkImageUrl, fetchRemoteImage, isPublicAddress, postPublic } from "./remote-image";

describe("isPublicAddress", () => {
  it("lets public addresses through", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "142.250.185.78", "2606:4700:4700::1111", "2a00:1450:4001:82a::200e"]) expect(isPublicAddress(ip)).toBe(true);
  });

  it("blocks loopback, private, link-local, metadata, carrier NAT, multicast and reserved ranges", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
      "224.0.0.1", "255.255.255.255", "192.0.2.1", "198.18.0.1",
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1",
      "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:7f00:1::1",
      "not an ip", "",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe("checkImageUrl", () => {
  it("accepts plain https addresses", () => {
    expect(checkImageUrl("https://images.example.com/a/b.jpg?x=1")).toEqual({ ok: true, url: new URL("https://images.example.com/a/b.jpg?x=1") });
  });

  it("refuses other schemes, credentials, odd ports and private IP literals", () => {
    for (const u of ["http://example.com/a.jpg", "file:///etc/passwd", "ftp://example.com/a", "https://user:pw@example.com/a.jpg", "https://example.com:8443/a.jpg", "https://127.0.0.1/a.jpg", "https://[::1]/a.jpg", "https://169.254.169.254/latest", "not a url"]) {
      expect(checkImageUrl(u).ok, u).toBe(false);
    }
  });
});

describe("fetchRemoteImage", () => {
  it("never connects to a host that resolves to this machine", async () => {
    expect(await fetchRemoteImage("https://localhost/a.png")).toMatchObject({ ok: false, error: "blocked_address" });
  });

  it("stops at the URL check before any network", async () => {
    expect(await fetchRemoteImage("http://example.com/a.png")).toMatchObject({ ok: false, error: "bad_url" });
  });
});

describe("webhook posts", () => {
  it("never posts to an internal or unencrypted address", async () => {
    for (const url of ["http://hooks.example.com/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://user:pw@hooks.example.com/x"]) {
      const res = await postPublic(url, "{}", { "content-type": "application/json" });
      expect(res, url).toMatchObject({ ok: false, error: expect.any(String) });
    }
  });
});

