import { createHash, randomBytes } from "node:crypto";

/**
 * API keys let agents (MCP) and the CLI act for an account: "tch_" + 40 base62 characters.
 * Only the SHA-256 of a key is stored; the key itself is shown exactly once, when it is issued.
 * An OAuth connection (claude.ai, Claude Code …) is the same kind of record without a key of its own (kind "oauth"):
 * its tokens hang on it, so the list, revocation, the daily limit and the statement treat both alike.
 */
export const MAX_ACTIVE_KEYS = 20;
/** Credits a key or connection may spend per 24 hours unless the owner changes it (decided 13.10.2026). */
export const DEFAULT_DAILY_LIMIT = 300;
const MAX_DAILY_LIMIT = 10_000_000;
const BODY_LENGTH = 40;
const KEY_PATTERN = /^tch_[0-9A-Za-z]{40}$/;
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** lastUsedAt is a hint for the key list, not an audit log: write it at most this often. */
const TOUCH_EVERY_MS = 5 * 60_000;

export type ApiKeyKind = "key" | "oauth";

export type ApiKeyRecord = {
  id: string;
  accountId: string;
  kind: ApiKeyKind;
  name: string;
  /** The first characters of the key, enough to recognise it in a list. "OAuth" for connections. */
  prefix: string;
  /** SHA-256 of the key. Connections have none. */
  hash?: string;
  /** The OAuth client of a connection. */
  clientId?: string;
  /** The account's e-mail when the key was issued, for display only. */
  email?: string;
  /** Credits per 24 hours; null = no limit. */
  dailyLimit: number | null;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
};

/** What the owner sees in the key list. Never the key or its hash. */
export type ApiKeyView = {
  id: string;
  kind: ApiKeyKind;
  name: string;
  prefix: string;
  dailyLimit: number | null;
  createdAt: number;
  lastUsedAt: number | null;
};

/** The account a valid key or connection acts for. */
export type ApiKeyPrincipal = { accountId: string; keyId: string; email?: string; kind: ApiKeyKind; dailyLimit: number | null };

export type IssueResult = { ok: true; key: string; view: ApiKeyView } | { ok: false; error: "invalid_name" | "too_many_keys" };
export type ConnectResult = { ok: true; id: string } | { ok: false; error: "invalid_name" | "too_many_keys" };

export interface ApiKeyRepository {
  /** Inserts the key unless the account already has `max` active keys and connections (atomic). False when capped. */
  insert(rec: ApiKeyRecord, max: number): Promise<boolean>;
  /** The key with this hash, unless it was revoked. */
  findActiveByHash(hash: string): Promise<ApiKeyRecord | undefined>;
  /** The account's active connection with this OAuth client. */
  findActiveConnection(accountId: string, clientId: string): Promise<ApiKeyRecord | undefined>;
  /** A key or connection by id, unless it was revoked. */
  getActive(id: string): Promise<ApiKeyRecord | undefined>;
  /** The account's active keys and connections, newest first. */
  listActive(accountId: string): Promise<ApiKeyRecord[]>;
  /** Revokes an active key of this account. False if there is none. */
  revoke(accountId: string, id: string, at: number): Promise<boolean>;
  setDailyLimit(accountId: string, id: string, limit: number | null): Promise<boolean>;
  touch(id: string, at: number): Promise<void>;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** `prefix` + `length` random base62 characters. */
export function randomToken(prefix: string, length = BODY_LENGTH): string {
  let body = "";
  while (body.length < length) {
    for (const b of randomBytes(64)) {
      // 248 = 4 × 62: dropping the top bytes keeps every character equally likely.
      if (b < 248) body += ALPHABET[b % 62];
      if (body.length === length) break;
    }
  }
  return `${prefix}${body}`;
}

function view(r: ApiKeyRecord): ApiKeyView {
  return { id: r.id, kind: r.kind, name: r.name, prefix: r.prefix, dailyLimit: r.dailyLimit, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt ?? null };
}

function principalOf(r: ApiKeyRecord): ApiKeyPrincipal {
  return { accountId: r.accountId, keyId: r.id, ...(r.email ? { email: r.email } : {}), kind: r.kind, dailyLimit: r.dailyLimit };
}

const validName = (name: string) => name.length >= 1 && name.length <= 60;
const validLimit = (n: number | null) => n === null || (Number.isInteger(n) && n > 0 && n <= MAX_DAILY_LIMIT);

export function createApiKeys(deps: { repo: ApiKeyRepository; now?: () => number; newId?: () => string }) {
  const { repo, now = Date.now, newId = () => crypto.randomUUID() } = deps;

  async function touch(r: ApiKeyRecord) {
    const t = now();
    if (r.lastUsedAt === undefined || t - r.lastUsedAt >= TOUCH_EVERY_MS) await repo.touch(r.id, t);
  }

  async function issue(accountId: string, input: { name: string; email?: string; dailyLimit?: number | null }): Promise<IssueResult> {
    const name = input.name.trim();
    if (!validName(name)) return { ok: false, error: "invalid_name" };
    const key = randomToken("tch_");
    const rec: ApiKeyRecord = {
      id: newId(), accountId, kind: "key", name, prefix: key.slice(0, 10), hash: hashKey(key), createdAt: now(),
      dailyLimit: input.dailyLimit !== undefined && validLimit(input.dailyLimit) ? input.dailyLimit : DEFAULT_DAILY_LIMIT,
      ...(input.email ? { email: input.email } : {}),
    };
    if (!(await repo.insert(rec, MAX_ACTIVE_KEYS))) return { ok: false, error: "too_many_keys" };
    return { ok: true, key, view: view(rec) };
  }

  /** The connection of an OAuth client for this account: the active one, else a new one. */
  async function connect(accountId: string, input: { name: string; clientId: string; email?: string }): Promise<ConnectResult> {
    const existing = await repo.findActiveConnection(accountId, input.clientId);
    if (existing) return { ok: true, id: existing.id };
    const name = input.name.trim().slice(0, 60) || "App";
    const rec: ApiKeyRecord = {
      id: newId(), accountId, kind: "oauth", name, prefix: "OAuth", clientId: input.clientId, createdAt: now(),
      dailyLimit: DEFAULT_DAILY_LIMIT, ...(input.email ? { email: input.email } : {}),
    };
    if (!(await repo.insert(rec, MAX_ACTIVE_KEYS))) return { ok: false, error: "too_many_keys" };
    return { ok: true, id: rec.id };
  }

  async function verify(key: string): Promise<ApiKeyPrincipal | null> {
    if (!KEY_PATTERN.test(key)) return null;
    const rec = await repo.findActiveByHash(hashKey(key));
    if (!rec || rec.kind !== "key") return null;
    await touch(rec);
    return principalOf(rec);
  }

  /** An active key or connection by id: how OAuth tokens find the account they act for. */
  async function principal(id: string): Promise<ApiKeyPrincipal | null> {
    const rec = await repo.getActive(id);
    if (!rec) return null;
    await touch(rec);
    return principalOf(rec);
  }

  async function list(accountId: string): Promise<ApiKeyView[]> {
    return (await repo.listActive(accountId)).map(view);
  }

  async function revoke(accountId: string, id: string): Promise<boolean> {
    return repo.revoke(accountId, id, now());
  }

  async function setDailyLimit(accountId: string, id: string, limit: number | null): Promise<boolean> {
    return validLimit(limit) ? repo.setDailyLimit(accountId, id, limit) : false;
  }

  /** Ends the account's connection with an OAuth client, e.g. when one of its codes or refresh tokens is replayed. */
  async function disconnect(accountId: string, clientId: string): Promise<boolean> {
    const con = await repo.findActiveConnection(accountId, clientId);
    return con ? repo.revoke(accountId, con.id, now()) : false;
  }

  return { issue, connect, verify, principal, list, revoke, setDailyLimit, disconnect };
}

export type ApiKeys = ReturnType<typeof createApiKeys>;

export function createMemoryApiKeyRepository(): ApiKeyRepository {
  const keys = new Map<string, ApiKeyRecord>();
  const active = (r: ApiKeyRecord) => r.revokedAt === undefined;
  const copy = (r: ApiKeyRecord | undefined) => r && { ...r };
  return {
    async insert(rec, max) {
      const count = [...keys.values()].filter((r) => r.accountId === rec.accountId && active(r)).length;
      if (count >= max) return false;
      keys.set(rec.id, { ...rec });
      return true;
    },
    async findActiveByHash(hash) {
      return copy([...keys.values()].find((k) => k.hash === hash && active(k)));
    },
    async findActiveConnection(accountId, clientId) {
      return copy([...keys.values()].find((k) => k.kind === "oauth" && k.accountId === accountId && k.clientId === clientId && active(k)));
    },
    async getActive(id) {
      const r = keys.get(id);
      return r && active(r) ? copy(r) : undefined;
    },
    async listActive(accountId) {
      return [...keys.values()]
        .filter((r) => r.accountId === accountId && active(r))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => ({ ...r }));
    },
    async revoke(accountId, id, at) {
      const r = keys.get(id);
      if (!r || r.accountId !== accountId || !active(r)) return false;
      r.revokedAt = at;
      return true;
    },
    async setDailyLimit(accountId, id, limit) {
      const r = keys.get(id);
      if (!r || r.accountId !== accountId || !active(r)) return false;
      r.dailyLimit = limit;
      return true;
    },
    async touch(id, at) {
      const r = keys.get(id);
      if (r) r.lastUsedAt = at;
    },
  };
}
