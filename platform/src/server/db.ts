import pg from "pg";
import type { Db, Query } from "@/core/postgres-repository";

/** The part of a pg client a transaction uses. */
type TxClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  on(event: "error", listener: (e: Error) => void): unknown;
  removeListener(event: "error", listener: (e: Error) => void): unknown;
  /** With an error, pg-pool drops the connection instead of handing it out again. */
  release(err?: Error): void;
};
type PoolLike = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>; connect(): Promise<TxClient> };

/** The repository's Db interface on a pg pool (or anything shaped like one). */
export function dbOnPool(pool: PoolLike): Db {
  return {
    query: async (sql, params) => (await pool.query(sql, params)).rows as never,
    async tx(fn) {
      const client = await pool.connect();
      // pg-pool takes its error listener off a checked-out client. Without this one, a connection that dies during
      // the transaction emits an unhandled 'error' and takes the whole process down.
      let broken: Error | undefined;
      const onError = (e: Error) => void (broken ??= e);
      client.on("error", onError);
      const q: Query = async (sql, params) => {
        try {
          return (await client.query(sql, params)).rows as never;
        } catch (e) {
          // Anything but an answer from Postgres (socket closed, read timeout) leaves the connection in an unknown state.
          if (!(e instanceof pg.DatabaseError)) broken ??= e as Error;
          throw e;
        }
      };
      try {
        await q("begin");
        const result = await fn(q);
        await q("commit");
        return result;
      } catch (e) {
        // Only a healthy connection is rolled back and reused. A broken one is dropped; closing it rolls back on the server.
        if (!broken) await client.query("rollback").catch((re: Error) => void (broken = re));
        throw e;
      } finally {
        client.removeListener("error", onError);
        client.release(broken);
      }
    },
  };
}

export type PgDbOptions = {
  /** Connections per process. The Supabase session pooler is shared by every process, so keep it small. */
  max?: number;
  /** A database that does not answer fails the query after this long instead of hanging the worker. */
  connectTimeoutMs?: number;
  queryTimeoutMs?: number;
};

const g = globalThis as unknown as { __tachyonPools?: Map<string, Db & { pool: pg.Pool }> };

/**
 * node-postgres behind the repository's Db interface. Server-only: uses DATABASE_URL.
 * One pool per database and process (jobs, API keys and the model store share it; it survives hot reload).
 * Options apply when the pool is first created.
 */
export function createPgDb(connectionString: string, opts: PgDbOptions = {}): Db & { pool: pg.Pool } {
  const pools = (g.__tachyonPools ??= new Map());
  const existing = pools.get(connectionString);
  if (existing) return existing;

  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? (Number(process.env.DATABASE_POOL_MAX) || 5),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: opts.connectTimeoutMs ?? 10_000,
    query_timeout: opts.queryTimeoutMs ?? 20_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  });
  // An idle connection that the pooler or the network drops is an 'error' event on the pool; without a listener
  // Node ends the process. The pool replaces the connection on the next query.
  pool.on("error", (e) => console.warn(`[db] idle connection dropped: ${e.message}`));

  const db = { pool, ...dbOnPool(pool as unknown as PoolLike) };
  pools.set(connectionString, db);
  return db;
}
