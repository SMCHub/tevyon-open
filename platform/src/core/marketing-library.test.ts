import { describe, expect, it } from "vitest";
import { checkItem, createMemoryMarketingLibrary, createPostgresMarketingLibrary, type MarketingLibrary } from "./marketing-library";
import { pgliteDb } from "./testing/repositories";

const ACC = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
const UP = (n: string, acc = ACC) => `/api/media/uploads/${acc}/${n}.jpg`;
const JOB = "00000000-0000-4000-8000-0000000000f9";

describe("marketing library: checks", () => {
  it("keeps a product to its fields and limits, own uploads only", () => {
    const res = checkItem(ACC, "product", {
      name: "  Bio-Limo  ", description: "x".repeat(900), images: [UP("a"), UP("b", OTHER), "https://evil.example/c.jpg", UP("d")], pick: 1,
      source: "https://shop.ch/limo", extra: "dropped",
    });
    expect(res).toEqual({ ok: true, data: { name: "Bio-Limo", description: "x".repeat(400), images: [UP("a"), UP("d")], pick: 1, source: "https://shop.ch/limo" } });
  });

  it("refuses a product without an own image, a reference that is not an own upload, a favourite that is not a job id", () => {
    expect(checkItem(ACC, "product", { name: "x", images: [UP("a", OTHER)] })).toEqual({ ok: false, error: "invalid_item" });
    expect(checkItem(ACC, "reference", { url: "https://evil.example/x.png", name: "x" })).toEqual({ ok: false, error: "invalid_item" });
    expect(checkItem(ACC, "favorite", { jobId: "nope" })).toEqual({ ok: false, error: "invalid_item" });
    expect(checkItem(ACC, "favorite", { jobId: JOB })).toEqual({ ok: true, data: { jobId: JOB } });
  });

  it("keeps a project to its name, pin, creation time and own-looking job ids, each once and at most 500", () => {
    const J2 = "00000000-0000-4000-8000-0000000000fa";
    expect(checkItem(ACC, "project", { name: "  Sommer   Kampagne ", jobIds: [JOB, J2, JOB, "nope", 7], pinned: true, createdAt: 1_791_000_000_000, extra: 1 })).toEqual({
      ok: true, data: { name: "Sommer Kampagne", jobIds: [JOB, J2], pinned: true, createdAt: 1_791_000_000_000 },
    });
    expect(checkItem(ACC, "project", { name: "", jobIds: "x", pinned: "yes", createdAt: -4 })).toEqual({ ok: true, data: { name: "Unbenanntes Projekt", jobIds: [], pinned: false } });
    const many = Array.from({ length: 600 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const res = checkItem(ACC, "project", { name: "Viel", jobIds: many });
    expect(res.ok && (res.data.jobIds as string[]).length).toBe(500);
    expect(res.ok && (res.data.jobIds as string[])[0]).toBe(many[0]);
  });

  it("drops a source that is not an http address and a pick outside the images", () => {
    const res = checkItem(ACC, "product", { name: "x", images: [UP("a")], pick: 5, source: "javascript:alert(1)" });
    expect(res).toEqual({ ok: true, data: { name: "x", description: "", images: [UP("a")], pick: 0 } });
  });
});

const stores: [string, () => Promise<MarketingLibrary>][] = [
  ["memory", async () => createMemoryMarketingLibrary()],
  ["postgres", async () => createPostgresMarketingLibrary(await pgliteDb())],
];

describe.each(stores)("%s marketing library", (_name, make) => {
  it("stores, updates and removes an account's items, newest first, and never shows them to another account", async () => {
    const lib = await make();
    await lib.put(ACC, "product", "p1", { name: "Eins" }, 1);
    await lib.put(ACC, "product", "p2", { name: "Zwei" }, 2);
    await lib.put(ACC, "reference", "r1", { url: UP("r") }, 3);
    await lib.put(OTHER, "product", "p9", { name: "Fremd" }, 4);
    await lib.put(ACC, "product", "p1", { name: "Eins neu" }, 5);

    const all = await lib.list(ACC);
    expect(all.product.map((i) => [i.id, i.data])).toEqual([["p1", { name: "Eins neu" }], ["p2", { name: "Zwei" }]]);
    expect(all.reference.map((i) => i.id)).toEqual(["r1"]);
    expect(all.favorite).toEqual([]);
    expect(all.project).toEqual([]);

    await lib.put(ACC, "project", "pr1", { name: "Kampagne", jobIds: [JOB], pinned: false }, 6);
    expect((await lib.list(ACC)).project).toEqual([{ id: "pr1", data: { name: "Kampagne", jobIds: [JOB], pinned: false }, at: 6 }]);

    await lib.remove(ACC, "product", "p1");
    await lib.remove(ACC, "product", "nope");
    expect((await lib.list(ACC)).product.map((i) => i.id)).toEqual(["p2"]);
    expect((await lib.list(OTHER)).product.map((i) => i.id)).toEqual(["p9"]);
  });
});
