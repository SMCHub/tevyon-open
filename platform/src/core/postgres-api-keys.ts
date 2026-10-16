import type { ApiKeyKind, ApiKeyRecord, ApiKeyRepository } from "./api-keys";
import type { Db } from "./postgres-repository";

type Row = {
  id: string;
  account_id: string;
  kind: ApiKeyKind;
  name: string;
  prefix: string;
  key_hash: string | null;
  client_id: string | null;
  email: string | null;
  daily_limit: number | null;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
};

const COLS = "id, account_id, kind, name, prefix, key_hash, client_id, email, daily_limit, created_at, last_used_at, revoked_at";
const ms = (d: Date | string) => new Date(d).getTime();

function toRecord(r: Row): ApiKeyRecord {
  const rec: ApiKeyRecord = {
    id: r.id, accountId: r.account_id, kind: r.kind, name: r.name, prefix: r.prefix, dailyLimit: r.daily_limit, createdAt: ms(r.created_at),
  };
  if (r.key_hash) rec.hash = r.key_hash;
  if (r.client_id) rec.clientId = r.client_id;
  if (r.email) rec.email = r.email;
  if (r.last_used_at) rec.lastUsedAt = ms(r.last_used_at);
  if (r.revoked_at) rec.revokedAt = ms(r.revoked_at);
  return rec;
}

/** API keys and OAuth connections on Postgres (table api_keys, migrations 0003 and 0007). */
export function createPostgresApiKeyRepository(db: Db): ApiKeyRepository {
  return {
    async insert(rec, max) {
      return db.tx(async (q) => {
        // Serialises creation per account so the cap holds under concurrent requests.
        await q("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`api_keys:${rec.accountId}`]);
        const [row] = await q<{ n: number }>("select count(*)::int as n from api_keys where account_id = $1 and revoked_at is null", [rec.accountId]);
        if ((row?.n ?? 0) >= max) return false;
        await q(
          `insert into api_keys (id, account_id, kind, name, prefix, key_hash, client_id, email, daily_limit, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [rec.id, rec.accountId, rec.kind, rec.name, rec.prefix, rec.hash ?? null, rec.clientId ?? null, rec.email ?? null, rec.dailyLimit, new Date(rec.createdAt)],
        );
        return true;
      });
    },

    async findActiveByHash(hash) {
      const rows = await db.query<Row>(`select ${COLS} from api_keys where key_hash = $1 and revoked_at is null`, [hash]);
      return rows[0] && toRecord(rows[0]);
    },

    async findActiveConnection(accountId, clientId) {
      const rows = await db.query<Row>(
        `select ${COLS} from api_keys where kind = 'oauth' and account_id = $1 and client_id = $2 and revoked_at is null order by created_at desc limit 1`,
        [accountId, clientId],
      );
      return rows[0] && toRecord(rows[0]);
    },

    async getActive(id) {
      const rows = await db.query<Row>(`select ${COLS} from api_keys where id = $1 and revoked_at is null`, [id]);
      return rows[0] && toRecord(rows[0]);
    },

    async listActive(accountId) {
      const rows = await db.query<Row>(
        `select ${COLS} from api_keys where account_id = $1 and revoked_at is null order by created_at desc`,
        [accountId],
      );
      return rows.map(toRecord);
    },

    async revoke(accountId, id, at) {
      const rows = await db.query(
        "update api_keys set revoked_at = $3 where id = $1 and account_id = $2 and revoked_at is null returning id",
        [id, accountId, new Date(at)],
      );
      return rows.length > 0;
    },

    async setDailyLimit(accountId, id, limit) {
      const rows = await db.query(
        "update api_keys set daily_limit = $3 where id = $1 and account_id = $2 and revoked_at is null returning id",
        [id, accountId, limit],
      );
      return rows.length > 0;
    },

    async touch(id, at) {
      await db.query("update api_keys set last_used_at = $2 where id = $1", [id, new Date(at)]);
    },
  };
}
