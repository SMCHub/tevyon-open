import { checkItem, createMemoryMarketingLibrary, createPostgresMarketingLibrary, ITEM_ID, ITEM_KINDS, LIMITS, type ItemKind, type MarketingLibrary } from "@/core/marketing-library";
import { createPgDb } from "./db";

/**
 * The Marketing Agent's library behind /api/marketing/library. Until migration 0014 is applied the table is missing:
 * then every call answers storage_unavailable (503) and the page keeps its browser copy, nothing breaks.
 */
export type LibraryError = "storage_unavailable" | "invalid_kind" | "invalid_id" | "invalid_item" | "library_full";

// Versioned key: a running dev server keeps an older instance under the old name (V2 knows projects).
const g = globalThis as unknown as { __tachyonMarketingLibraryV2?: MarketingLibrary };

export function marketingLibrary(): MarketingLibrary {
  const url = process.env.DATABASE_URL;
  return (g.__tachyonMarketingLibraryV2 ??= url ? createPostgresMarketingLibrary(createPgDb(url)) : createMemoryMarketingLibrary());
}

/** Postgres "undefined_table": the migration is not in yet. */
const missingTable = (e: unknown) => (e as { code?: string })?.code === "42P01";

export function createLibraryService(store: MarketingLibrary, opts: { now?: () => number; log?: (m: string) => void } = {}) {
  const now = opts.now ?? Date.now;
  async function guard<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: LibraryError }> {
    try {
      return { ok: true, value: await run() };
    } catch (e) {
      if (missingTable(e)) return { ok: false, error: "storage_unavailable" };
      opts.log?.(`[marketing-library] ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, error: "storage_unavailable" };
    }
  }
  const kindOf = (k: string): ItemKind | undefined => (ITEM_KINDS as string[]).includes(k) ? (k as ItemKind) : undefined;

  return {
    async list(accountId: string) {
      const r = await guard(() => store.list(accountId));
      return r.ok ? { ok: true as const, library: r.value } : r;
    },
    async put(accountId: string, kindRaw: string, id: string, body: unknown) {
      const kind = kindOf(kindRaw);
      if (!kind) return { ok: false as const, error: "invalid_kind" as const };
      if (!ITEM_ID.test(id)) return { ok: false as const, error: "invalid_id" as const };
      const item = checkItem(accountId, kind, body);
      if (!item.ok) return item;
      const r = await guard(async () => {
        const lib = await store.list(accountId);
        if (!lib[kind].some((i) => i.id === id) && lib[kind].length >= LIMITS[kind]) return "full" as const;
        await store.put(accountId, kind, id, item.data, now());
        return "ok" as const;
      });
      if (!r.ok) return r;
      return r.value === "full" ? { ok: false as const, error: "library_full" as const } : { ok: true as const, item: { id, data: item.data } };
    },
    async remove(accountId: string, kindRaw: string, id: string) {
      const kind = kindOf(kindRaw);
      if (!kind) return { ok: false as const, error: "invalid_kind" as const };
      if (!ITEM_ID.test(id)) return { ok: false as const, error: "invalid_id" as const };
      const r = await guard(() => store.remove(accountId, kind, id));
      return r.ok ? { ok: true as const } : r;
    },
  };
}

export const LIBRARY_STATUS: Record<LibraryError, number> = { storage_unavailable: 503, invalid_kind: 404, invalid_id: 400, invalid_item: 400, library_full: 409 };
