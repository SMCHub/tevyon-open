import type { Db } from "./postgres-repository";

/**
 * The Marketing Agent's library per account: saved products, ad references, favourite results and projects (folders
 * of generations, since 14.10.2026). Before 14.10.2026 it lived in the browser only; on the server it follows the
 * account to every device. Items are small JSON objects, checked here before they are stored: only the caller's own
 * uploads, bounded text, nothing else.
 */
export type ItemKind = "product" | "reference" | "favorite" | "project";
export const ITEM_KINDS: ItemKind[] = ["product", "reference", "favorite", "project"];
export type LibraryItem = { id: string; data: Record<string, unknown>; at: number };
export type Library = Record<ItemKind, LibraryItem[]>;

/** Most items per account and kind. */
export const LIMITS: Record<ItemKind, number> = { product: 200, reference: 100, favorite: 2000, project: 100 };
/** Most generations in one project (newest first, the client keeps that order). */
export const PROJECT_JOBS = 500;

export interface MarketingLibrary {
  list(accountId: string): Promise<Library>;
  put(accountId: string, kind: ItemKind, id: string, data: Record<string, unknown>, at: number): Promise<void>;
  remove(accountId: string, kind: ItemKind, id: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const ownUpload = (accountId: string, v: unknown): v is string =>
  typeof v === "string" && v.length < 300 && new RegExp(`^/api/media/uploads/${accountId}/[A-Za-z0-9_-]+\\.(png|jpe?g|webp)$`).test(v);

/** The stored form of an item, or invalid_item. */
export function checkItem(accountId: string, kind: ItemKind, raw: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: "invalid_item" } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (kind === "product") {
    const images = (Array.isArray(b.images) ? b.images : []).filter((u) => ownUpload(accountId, u)).slice(0, 5) as string[];
    if (!images.length) return { ok: false, error: "invalid_item" };
    const pick = typeof b.pick === "number" && Number.isInteger(b.pick) && b.pick >= 0 && b.pick < images.length ? b.pick : 0;
    let source: string | undefined;
    try {
      const u = typeof b.source === "string" ? new URL(b.source) : undefined;
      if (u && (u.protocol === "https:" || u.protocol === "http:")) source = u.toString().slice(0, 500);
    } catch {}
    return { ok: true, data: { name: text(b.name, 80) || "Produkt", description: text(b.description, 400), images, pick, ...(source ? { source } : {}) } };
  }
  if (kind === "reference") {
    if (!ownUpload(accountId, b.url)) return { ok: false, error: "invalid_item" };
    return { ok: true, data: { url: b.url, name: text(b.name, 40) || "Referenz" } };
  }
  if (kind === "project") {
    // Job ids only by their form: a project lists what the account made, the jobs themselves stay behind the account.
    const ids = [...new Set((Array.isArray(b.jobIds) ? b.jobIds : []).filter((v): v is string => typeof v === "string" && UUID.test(v)))].slice(0, PROJECT_JOBS);
    const created = typeof b.createdAt === "number" && Number.isInteger(b.createdAt) && b.createdAt > 0 && b.createdAt < 8.64e15 ? { createdAt: b.createdAt } : {};
    return { ok: true, data: { name: text(b.name, 60) || "Unbenanntes Projekt", jobIds: ids, pinned: b.pinned === true, ...created } };
  }
  if (typeof b.jobId !== "string" || !UUID.test(b.jobId)) return { ok: false, error: "invalid_item" };
  return { ok: true, data: { jobId: b.jobId } };
}

const empty = (): Library => ({ product: [], reference: [], favorite: [], project: [] });

export function createMemoryMarketingLibrary(): MarketingLibrary {
  const items = new Map<string, LibraryItem & { accountId: string; kind: ItemKind }>();
  const key = (a: string, k: ItemKind, id: string) => `${a}|${k}|${id}`;
  return {
    async list(accountId) {
      const lib = empty();
      for (const i of [...items.values()].filter((x) => x.accountId === accountId).sort((a, b) => b.at - a.at)) {
        lib[i.kind].push({ id: i.id, data: structuredClone(i.data), at: i.at });
      }
      return lib;
    },
    async put(accountId, kind, id, data, at) {
      items.set(key(accountId, kind, id), { accountId, kind, id, data: structuredClone(data), at });
    },
    async remove(accountId, kind, id) {
      items.delete(key(accountId, kind, id));
    },
  };
}

export function createPostgresMarketingLibrary(db: Db): MarketingLibrary {
  return {
    async list(accountId) {
      const rows = await db.query<{ kind: ItemKind; id: string; data: Record<string, unknown>; updated_at: Date | string }>(
        "select kind, id, data, updated_at from marketing_items where account_id = $1 order by updated_at desc",
        [accountId],
      );
      const lib = empty();
      for (const r of rows) lib[r.kind]?.push({ id: r.id, data: r.data, at: new Date(r.updated_at).getTime() });
      return lib;
    },
    async put(accountId, kind, id, data, at) {
      await db.query(
        `insert into marketing_items (account_id, kind, id, data, updated_at) values ($1, $2, $3, $4, $5)
         on conflict (account_id, kind, id) do update set data = excluded.data, updated_at = excluded.updated_at`,
        [accountId, kind, id, JSON.stringify(data), new Date(at)],
      );
    },
    async remove(accountId, kind, id) {
      await db.query("delete from marketing_items where account_id = $1 and kind = $2 and id = $3", [accountId, kind, id]);
    },
  };
}
