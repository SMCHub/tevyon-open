/**
 * Keeps a list of the page (products, ad references, favourites, projects) in step with the account's library on the server
 * (/api/marketing/library). Pure helpers here; the hook in marketing-agent.tsx calls them. Without the server table
 * (503 until migration 0014) the page works from its browser copy as before.
 */
export type ItemKind = "product" | "reference" | "favorite" | "project";
export type ServerItem = { id: string; data: Record<string, unknown> };

/** What changed between two versions of a list: items to store (new or different) and ids to remove. */
export function diffList<T extends { id: string }>(before: T[], after: T[], data: (t: T) => Record<string, unknown>) {
  const old = new Map(before.map((t) => [t.id, JSON.stringify(data(t))]));
  const now = new Set(after.map((t) => t.id));
  return {
    put: after.filter((t) => old.get(t.id) !== JSON.stringify(data(t))),
    remove: before.filter((t) => !now.has(t.id)).map((t) => t.id),
  };
}

/**
 * The first look at the server: its items win, items only in this browser are kept (and uploaded once), so nothing
 * saved before the library moved to the server is lost.
 */
export function mergeFirst<T extends { id: string }>(server: T[], local: T[]) {
  const ids = new Set(server.map((t) => t.id));
  const upload = local.filter((t) => !ids.has(t.id));
  return { list: [...server, ...upload], upload };
}

type Request = (method: "PUT" | "DELETE", path: string, body: Record<string, unknown> | undefined, keepalive: boolean) => Promise<unknown>;

/**
 * Sends library changes to the server. A change waits `delay` ms (typing a name is one change, not one per key; the
 * latest version wins), a removal goes at once and drops a waiting change. Per item one request at a time, so an older
 * version can never arrive after a newer one. `flush` sends what still waits (when the page goes away, kept alive).
 * An item the server refuses for good (400: not this account's upload, broken data) goes to `onRefused`, so the page
 * drops it instead of sending it again on every visit; a full library (409) or an outage may take it later.
 */
export function createLibrarySender(request: Request, delay = 400, onRefused?: (kind: ItemKind, id: string) => void) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const waiting = new Map<string, () => void>();
  const queues = new Map<string, Promise<unknown>>();
  function send(method: "PUT" | "DELETE", kind: ItemKind, id: string, data?: Record<string, unknown>) {
    const key = `${kind}/${id}`;
    clearTimeout(timers.get(key));
    const go = (keepalive = false) => {
      timers.delete(key);
      waiting.delete(key);
      const next = (queues.get(key) ?? Promise.resolve())
        .then(() => request(method, `/api/marketing/library/${kind}/${encodeURIComponent(id)}`, data, keepalive))
        .then((res) => (res as { status?: number } | undefined)?.status === 400 && onRefused?.(kind, id))
        .catch(() => {});
      queues.set(key, next);
      void next.then(() => queues.get(key) === next && queues.delete(key));
    };
    if (method === "DELETE") {
      waiting.delete(key);
      return go();
    }
    waiting.set(key, () => go(true));
    timers.set(key, setTimeout(go, delay));
  }
  return { send, flush: () => [...waiting.values()].forEach((f) => f()) };
}
