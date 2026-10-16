import type { ClientRecord, CodeRecord, DeviceRecord, OAuthRepository, TokenRecord } from "./oauth";
import type { Db } from "./postgres-repository";

/** OAuth clients, codes, tokens and device logins on Postgres (migration 0007). */
type ClientRow = {
  id: string; secret_hash: string | null; name: string; redirect_uris: string[]; grant_types: string[]; auth_method: ClientRecord["authMethod"];
  created_at: Date | string; used_at: Date | string | null;
};
type CodeRow = {
  code_hash: string; client_id: string; account_id: string; email: string | null; redirect_uri: string; code_challenge: string;
  resource: string | null; scope: string; expires_at: Date | string; used_at: Date | string | null;
};
type TokenRow = {
  token_hash: string; kind: TokenRecord["kind"]; grant_id: string; client_id: string; scope: string; resource: string | null;
  expires_at: Date | string; used_at: Date | string | null; revoked_at: Date | string | null;
};
type DeviceRow = {
  id: string; code_hash: string; user_code: string; client_id: string; name: string | null; scope: string; interval_s: number;
  expires_at: Date | string; last_poll_at: Date | string | null; status: DeviceRecord["status"]; account_id: string | null; email: string | null;
};

const ms = (d: Date | string) => new Date(d).getTime();

function client(r: ClientRow): ClientRecord {
  return {
    id: r.id, name: r.name, redirectUris: r.redirect_uris, grantTypes: r.grant_types, authMethod: r.auth_method, createdAt: ms(r.created_at),
    ...(r.secret_hash ? { secretHash: r.secret_hash } : {}), ...(r.used_at ? { usedAt: ms(r.used_at) } : {}),
  };
}

function code(r: CodeRow): CodeRecord {
  return {
    hash: r.code_hash, clientId: r.client_id, accountId: r.account_id, redirectUri: r.redirect_uri, challenge: r.code_challenge, scope: r.scope,
    expiresAt: ms(r.expires_at), ...(r.email ? { email: r.email } : {}), ...(r.resource ? { resource: r.resource } : {}),
    ...(r.used_at ? { usedAt: ms(r.used_at) } : {}),
  };
}

function token(r: TokenRow): TokenRecord {
  return {
    hash: r.token_hash, kind: r.kind, grantId: r.grant_id, clientId: r.client_id, scope: r.scope, expiresAt: ms(r.expires_at),
    ...(r.resource ? { resource: r.resource } : {}), ...(r.used_at ? { usedAt: ms(r.used_at) } : {}), ...(r.revoked_at ? { revokedAt: ms(r.revoked_at) } : {}),
  };
}

function device(r: DeviceRow): DeviceRecord {
  return {
    id: r.id, codeHash: r.code_hash, userCode: r.user_code, clientId: r.client_id, scope: r.scope, interval: r.interval_s,
    expiresAt: ms(r.expires_at), status: r.status, ...(r.name ? { name: r.name } : {}), ...(r.last_poll_at ? { lastPollAt: ms(r.last_poll_at) } : {}),
    ...(r.account_id ? { accountId: r.account_id } : {}), ...(r.email ? { email: r.email } : {}),
  };
}

/** Clients never used (migration 0013): no code yet, and to be sure no connection either. */
const UNUSED_CLIENTS = `delete from oauth_clients c where c.used_at is null and c.created_at < $1
  and not exists (select 1 from api_keys k where k.client_id = c.id) returning c.id`;

export function createPostgresOAuthRepository(db: Db): OAuthRepository {
  return {
    async touchClient(id, at) {
      await db.query("update oauth_clients set used_at = $2 where id = $1 and used_at is null", [id, new Date(at)]);
    },
    async cleanup(before) {
      const count = async (sql: string, at: number) => (await db.query(sql, [new Date(at)])).length;
      return {
        codes: await count("delete from oauth_codes where expires_at < $1 returning code_hash", before.codes),
        devices: await count("delete from oauth_devices where expires_at < $1 returning id", before.devices),
        tokens: await count("delete from oauth_tokens where expires_at < $1 returning token_hash", before.tokens),
        clients: await count(UNUSED_CLIENTS, before.unusedClients),
      };
    },
    async insertClient(c) {
      await db.query(
        `insert into oauth_clients (id, secret_hash, name, redirect_uris, grant_types, auth_method, created_at) values ($1, $2, $3, $4, $5, $6, $7)`,
        [c.id, c.secretHash ?? null, c.name, c.redirectUris, c.grantTypes, c.authMethod, new Date(c.createdAt)],
      );
    },
    async getClient(id) {
      const [r] = await db.query<ClientRow>("select * from oauth_clients where id = $1", [id]);
      return r && client(r);
    },
    async insertCode(c) {
      await db.query(
        `insert into oauth_codes (code_hash, client_id, account_id, email, redirect_uri, code_challenge, resource, scope, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [c.hash, c.clientId, c.accountId, c.email ?? null, c.redirectUri, c.challenge, c.resource ?? null, c.scope, new Date(c.expiresAt)],
      );
    },
    async useCode(hash, at) {
      const [fresh] = await db.query<CodeRow>("update oauth_codes set used_at = $2 where code_hash = $1 and used_at is null returning *", [hash, new Date(at)]);
      if (fresh) return { code: code(fresh), reused: false };
      const [old] = await db.query<CodeRow>("select * from oauth_codes where code_hash = $1", [hash]);
      return old ? { code: code(old), reused: true } : undefined;
    },
    async insertToken(t) {
      await db.query(
        `insert into oauth_tokens (token_hash, kind, grant_id, client_id, scope, resource, expires_at) values ($1, $2, $3, $4, $5, $6, $7)`,
        [t.hash, t.kind, t.grantId, t.clientId, t.scope, t.resource ?? null, new Date(t.expiresAt)],
      );
    },
    async getToken(hash) {
      const [r] = await db.query<TokenRow>("select * from oauth_tokens where token_hash = $1", [hash]);
      return r && token(r);
    },
    async useToken(hash, at) {
      const rows = await db.query("update oauth_tokens set used_at = $2 where token_hash = $1 and used_at is null returning token_hash", [hash, new Date(at)]);
      return rows.length > 0;
    },
    async revokeToken(hash, at) {
      await db.query("update oauth_tokens set revoked_at = $2 where token_hash = $1 and revoked_at is null", [hash, new Date(at)]);
    },
    async insertDevice(d) {
      const rows = await db.query(
        `insert into oauth_devices (id, code_hash, user_code, client_id, name, scope, interval_s, expires_at, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (user_code) do nothing returning id`,
        [d.id, d.codeHash, d.userCode, d.clientId, d.name ?? null, d.scope, d.interval, new Date(d.expiresAt), d.status],
      );
      return rows.length > 0;
    },
    async getDeviceByCode(codeHash) {
      const [r] = await db.query<DeviceRow>("select * from oauth_devices where code_hash = $1", [codeHash]);
      return r && device(r);
    },
    async getDeviceByUserCode(userCode) {
      const [r] = await db.query<DeviceRow>("select * from oauth_devices where user_code = $1", [userCode]);
      return r && device(r);
    },
    async updateDevice(id, from, patch) {
      const rows = await db.query(
        `update oauth_devices set status = $3, account_id = coalesce($4, account_id), email = coalesce($5, email)
         where id = $1 and status = $2 returning id`,
        [id, from, patch.status, patch.accountId ?? null, patch.email ?? null],
      );
      return rows.length > 0;
    },
    async touchDevicePoll(id, at, interval) {
      await db.query("update oauth_devices set last_poll_at = $2, interval_s = $3 where id = $1", [id, new Date(at), interval]);
    },
  };
}
