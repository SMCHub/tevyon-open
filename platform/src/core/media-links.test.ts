import { describe, expect, it } from "vitest";
import { createMediaLinks } from "./media-links";

const SECRET = "test-secret-with-enough-entropy-0123456789";

function setup() {
  let t = Date.UTC(2026, 9, 13, 12, 0, 0);
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  return { links: createMediaLinks({ secret: SECRET, now: clock.now, ttlSeconds: 3600 }), clock };
}

function parts(url: string) {
  const u = new URL(url, "https://app.tachyon.test");
  return { key: u.pathname.replace(/^\/api\/media\//, ""), exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
}

describe("media links", () => {
  it("signs a media URL so it opens without a login until it expires", () => {
    const { links, clock } = setup();
    const url = links.sign("/api/media/job-1/0.png");
    expect(url).toMatch(/^\/api\/media\/job-1\/0\.png\?exp=\d+&sig=[\w-]+$/);

    const p = parts(url);
    expect(links.verify(p.key, p.exp, p.sig)).toBe(true);

    clock.advance(3601 * 1000);
    expect(links.verify(p.key, p.exp, p.sig)).toBe(false);
  });

  it("makes absolute links for clients outside the browser", () => {
    const { links } = setup();
    expect(links.sign("/api/media/job-1/0.png", "https://app.tachyon.test")).toMatch(/^https:\/\/app\.tachyon\.test\/api\/media\/job-1\/0\.png\?exp=/);
  });

  it("rejects a signature for another file, a moved expiry or a forged signature", () => {
    const { links } = setup();
    const p = parts(links.sign("/api/media/job-1/0.png"));
    expect(links.verify("job-2/0.png", p.exp, p.sig)).toBe(false);
    expect(links.verify(p.key, String(Number(p.exp) + 3600), p.sig)).toBe(false);
    expect(links.verify(p.key, p.exp, "AAAA" + p.sig?.slice(4))).toBe(false);
    expect(links.verify(p.key, p.exp, null)).toBe(false);
    expect(links.verify(p.key, null, p.sig)).toBe(false);
    expect(links.verify(p.key, "soon", p.sig)).toBe(false);
  });

  it("does not trust links signed with another secret", () => {
    const { links } = setup();
    const other = createMediaLinks({ secret: "another-secret-with-enough-entropy-987654", now: () => Date.UTC(2026, 9, 13, 12) });
    const p = parts(other.sign("/api/media/job-1/0.png"));
    expect(links.verify(p.key, p.exp, p.sig)).toBe(false);
  });

  it("only signs Tachyon media paths", () => {
    const { links } = setup();
    expect(() => links.sign("https://vendor.example/file.png")).toThrow();
    expect(() => links.sign("/api/jobs")).toThrow();
  });

  it("refuses to run with a weak secret", () => {
    expect(() => createMediaLinks({ secret: "short" })).toThrow();
  });
});
