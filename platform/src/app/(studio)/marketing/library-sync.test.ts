import { describe, expect, it, vi } from "vitest";
import { createLibrarySender, diffList, mergeFirst } from "./library-sync";

type P = { id: string; name: string };
const data = (p: P) => ({ name: p.name });

describe("marketing library sync", () => {
  it("stores what is new or changed and removes what is gone", () => {
    const before: P[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
    const after: P[] = [{ id: "d", name: "D" }, { id: "a", name: "A" }, { id: "b", name: "B2" }];
    const d = diffList(before, after, data);
    expect(d.put.map((p) => p.id)).toEqual(["d", "b"]);
    expect(d.remove).toEqual(["c"]);
  });

  it("keeps browser-only items on the first sync and marks them for upload", () => {
    const server: P[] = [{ id: "a", name: "A server" }];
    const local: P[] = [{ id: "a", name: "A local" }, { id: "x", name: "X" }];
    expect(mergeFirst(server, local)).toEqual({ list: [{ id: "a", name: "A server" }, { id: "x", name: "X" }], upload: [{ id: "x", name: "X" }] });
  });
});

describe("marketing library sender", () => {
  function setup() {
    const sent: { method: string; path: string; body?: unknown; keepalive: boolean }[] = [];
    const answers: (() => void)[] = [];
    const request = (method: string, path: string, body: Record<string, unknown> | undefined, keepalive: boolean) => {
      sent.push({ method, path, ...(body ? { body } : {}), keepalive });
      return new Promise<void>((done) => answers.push(done));
    };
    return { sent, answers, sender: createLibrarySender(request, 400) };
  }

  it("sends a name typed key by key once, with the final text", async () => {
    vi.useFakeTimers();
    const { sent, sender } = setup();
    for (const name of ["I", "In", "Ing", "Ingwer"]) sender.send("PUT", "product", "p1", { name });
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    expect(sent).toEqual([{ method: "PUT", path: "/api/marketing/library/product/p1", body: { name: "Ingwer" }, keepalive: false }]);
    vi.useRealTimers();
  });

  it("removes at once and drops a change still waiting for that item", async () => {
    vi.useFakeTimers();
    const { sent, sender } = setup();
    sender.send("PUT", "reference", "r1", { name: "x" });
    sender.send("DELETE", "reference", "r1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.map((r) => r.method)).toEqual(["DELETE"]);
    vi.useRealTimers();
  });

  it("sends one request per item at a time, so an older version never lands after a newer one", async () => {
    vi.useFakeTimers();
    const { sent, answers, sender } = setup();
    sender.send("PUT", "product", "p1", { name: "A" });
    await vi.advanceTimersByTimeAsync(400);
    sender.send("PUT", "product", "p1", { name: "B" });
    await vi.advanceTimersByTimeAsync(400);
    expect(sent.map((r) => (r.body as { name: string }).name)).toEqual(["A"]);
    answers[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((r) => (r.body as { name: string }).name)).toEqual(["A", "B"]);
    // Other items do not wait.
    sender.send("DELETE", "favorite", "f1");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)?.path).toBe("/api/marketing/library/favorite/f1");
    vi.useRealTimers();
  });

  it("reports an item the server refuses for good, so the page drops it instead of sending it on every visit", async () => {
    vi.useFakeTimers();
    const refused: string[] = [];
    const status: Record<string, number> = { "/api/marketing/library/product/foreign": 400, "/api/marketing/library/product/full": 409 };
    const sender = createLibrarySender(
      async (_m, path) => ({ status: status[path] ?? 200 }),
      400,
      (kind, id) => refused.push(`${kind}/${id}`),
    );
    for (const id of ["foreign", "full", "ok"]) sender.send("PUT", "product", id, { name: id });
    await vi.advanceTimersByTimeAsync(400);
    // Only a 400 is final: a full library (409) or an outage may take the item later.
    expect(refused).toEqual(["product/foreign"]);
    vi.useRealTimers();
  });

  it("sends what is still waiting when the page goes away, kept alive", async () => {
    vi.useFakeTimers();
    const { sent, sender } = setup();
    sender.send("PUT", "product", "p 1", { name: "Last" });
    sender.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{ method: "PUT", path: "/api/marketing/library/product/p%201", body: { name: "Last" }, keepalive: true }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    vi.useRealTimers();
  });
});
