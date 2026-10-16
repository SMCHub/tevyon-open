import { describe, expect, it } from "vitest";
import { createMemoryMarketingLibrary, LIMITS, type MarketingLibrary } from "../core/marketing-library";
import { createLibraryService } from "./marketing-library";

const ACC = "00000000-0000-4000-8000-0000000000e1";
const UP = `/api/media/uploads/${ACC}/a.jpg`;

describe("marketing library service", () => {
  it("stores checked items and lists them per kind", async () => {
    const svc = createLibraryService(createMemoryMarketingLibrary(), { now: () => 5 });
    expect(await svc.put(ACC, "product", "p1", { name: "Limo", images: [UP] })).toEqual({ ok: true, item: { id: "p1", data: { name: "Limo", description: "", images: [UP], pick: 0 } } });
    const res = await svc.list(ACC);
    if (!res.ok) throw new Error(res.error);
    expect(res.library.product).toEqual([{ id: "p1", data: { name: "Limo", description: "", images: [UP], pick: 0 }, at: 5 }]);
  });

  it("refuses unknown kinds, odd ids and invalid items", async () => {
    const svc = createLibraryService(createMemoryMarketingLibrary());
    expect(await svc.put(ACC, "secret", "x", {})).toEqual({ ok: false, error: "invalid_kind" });
    expect(await svc.put(ACC, "product", "../x", {})).toEqual({ ok: false, error: "invalid_id" });
    expect(await svc.put(ACC, "reference", "r", { url: "https://x.example/a.png" })).toEqual({ ok: false, error: "invalid_item" });
  });

  it("stops at the limit for new items but still updates existing ones", async () => {
    const store = createMemoryMarketingLibrary();
    for (let i = 0; i < LIMITS.reference; i++) await store.put(ACC, "reference", `r${i}`, { url: UP }, i);
    const svc = createLibraryService(store);
    expect(await svc.put(ACC, "reference", "new", { url: UP })).toEqual({ ok: false, error: "library_full" });
    expect((await svc.put(ACC, "reference", "r1", { url: UP, name: "neu" })).ok).toBe(true);
  });

  it("says storage_unavailable while the table is missing, so the page keeps its browser copy", async () => {
    const missing = Object.assign(new Error('relation "marketing_items" does not exist'), { code: "42P01" });
    const broken: MarketingLibrary = { list: () => Promise.reject(missing), put: () => Promise.reject(missing), remove: () => Promise.reject(missing) };
    const svc = createLibraryService(broken);
    expect(await svc.list(ACC)).toEqual({ ok: false, error: "storage_unavailable" });
    expect(await svc.put(ACC, "favorite", "f", { jobId: "00000000-0000-4000-8000-0000000000f9" })).toEqual({ ok: false, error: "storage_unavailable" });
    expect(await svc.remove(ACC, "favorite", "f")).toEqual({ ok: false, error: "storage_unavailable" });
  });
});
