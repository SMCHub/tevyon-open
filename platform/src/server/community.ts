import { createCommunity, createMemoryCommunityStore, createPostgresCommunityStore, type CommunityStore } from "@/core/community";
import type { Account } from "./account";
import { createPgDb } from "./db";
import { runtime } from "./runtime";

// Versioned key: a running dev server keeps an older instance under an older name (V2 knows likes, follows, avatars).
const g = globalThis as unknown as { __tachyonCommunityStoreV2?: CommunityStore };

/** Profiles and publications: Postgres with DATABASE_URL, else in memory (local without a database, like the jobs). */
export function communityStore(): CommunityStore {
  const url = process.env.DATABASE_URL;
  return (g.__tachyonCommunityStoreV2 ??= url ? createPostgresCommunityStore(createPgDb(url)) : createMemoryCommunityStore());
}

/** The community over the runtime's jobs: publishing reads the owner's own view of a job (jobs.get), never the record. */
export async function community() {
  const { jobs } = await runtime();
  return createCommunity({ store: communityStore(), job: (accountId, jobId) => jobs.get(accountId, jobId) });
}

/**
 * The answer when the community store fails. Until migrations 0017/0018 are applied their tables are missing (Postgres
 * «undefined_table», «undefined_column»): the Studio then says the community is not ready instead of breaking.
 */
export function storageFailure(e: unknown): Response {
  const code = (e as { code?: string })?.code;
  if (code !== "42P01" && code !== "42703") console.error("[community]", e);
  return Response.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
}

/** HTTP status per community error. */
export const COMMUNITY_STATUS: Record<string, number> = {
  invalid_handle: 400, reserved_handle: 400, invalid_name: 400, reserved_name: 400, invalid_bio: 400, invalid_avatar: 400, terms_required: 400,
  handle_taken: 409, profile_required: 409, not_ready: 409, hidden: 409, consent_required: 422,
  not_found: 404, invalid_reason: 400, own_creation: 409, self: 409,
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Query parameters of a community list: kind (image | video), sort (new | popular), following (1), before (cursor), limit. */
export function feedOptions(req: Request) {
  const q = new URL(req.url).searchParams;
  const limit = Number(q.get("limit"));
  return {
    kind: q.get("kind") ?? undefined,
    before: q.get("before") ?? undefined,
    sort: q.get("sort") ?? undefined,
    following: q.get("following") === "1",
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
  };
}

/** A handle from a route segment: decoded where possible, else as it came (the core checks its form). */
export function handleParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Operators moderate the community (/moderation): Studio sessions whose e-mail is in OPERATOR_EMAILS (comma-separated).
 * Never an API key or OAuth connection.
 */
export function isOperator(account: Pick<Account, "email" | "via"> | null): boolean {
  if (!account || account.via !== "session" || !account.email) return false;
  const list = (process.env.OPERATOR_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(account.email.toLowerCase());
}
