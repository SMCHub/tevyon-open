import { describe, expect, it } from "vitest";
import { createUploadLinks } from "./upload-links";

const SECRET = "test-secret-with-enough-entropy-0123456789";
const ACC = "00000000-0000-4000-8000-000000000001";

function setup() {
  let t = Date.UTC(2026, 9, 13, 12);
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  return { links: createUploadLinks({ secret: SECRET, now: clock.now }), clock };
}

describe("upload links", () => {
  it("lets an agent put one image into the account for fifteen minutes", () => {
    const { links, clock } = setup();
    const q = links.sign(ACC, "img-1");
    expect(links.verify(q)).toEqual({ accountId: ACC, id: "img-1" });
    clock.advance(15 * 60_000 + 1000);
    expect(links.verify(q)).toBeNull();
  });

  it("rejects a link for another account, another id or a forged signature", () => {
    const { links } = setup();
    const q = links.sign(ACC, "img-1");
    const other = new URLSearchParams(q);
    other.set("acc", "00000000-0000-4000-8000-000000000002");
    expect(links.verify(other)).toBeNull();
    const id = new URLSearchParams(q);
    id.set("id", "img-2");
    expect(links.verify(id)).toBeNull();
    const sig = new URLSearchParams(q);
    sig.set("sig", "A" + (sig.get("sig") ?? "").slice(1));
    expect(links.verify(sig)).toBeNull();
    expect(links.verify(new URLSearchParams())).toBeNull();
  });

  it("is never valid as a media link and the other way round", async () => {
    const { createMediaLinks } = await import("./media-links");
    const media = createMediaLinks({ secret: SECRET, now: () => Date.UTC(2026, 9, 13, 12) });
    const { links } = setup();
    const q = links.sign(ACC, "img-1");
    expect(media.verify(`${ACC}/img-1`, q.get("exp"), q.get("sig"))).toBe(false);
  });
});
