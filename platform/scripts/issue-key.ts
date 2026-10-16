// Issues an API key for an account and stores it in the macOS keychain, where the CLI finds it. The key is never printed.
// Usage: node --env-file=.env.local scripts/issue-key.ts <email> [name] [base-url]
//   base-url defaults to http://localhost:3100 (keychain: service "Tachyon CLI", account = base URL).
// For development. In production, keys come from Tachyon Studio («API & MCP») or `tachyon login`.
import { execFileSync } from "node:child_process";
import pg from "pg";
import { createApiKeys } from "../src/core/api-keys.ts";
import { createPostgresApiKeyRepository } from "../src/core/postgres-api-keys.ts";

const [email, name = "CLI (Dev)", base = "http://localhost:3100"] = process.argv.slice(2);
if (!email) throw new Error("usage: scripts/issue-key.ts <email> [name] [base-url]");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");

const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });
const db = {
  query: async (sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows,
  async tx<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
      await client.query("commit");
      return result;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  },
};

const [user] = await db.query("select id from auth.users where lower(email) = lower($1)", [email]);
if (!user) throw new Error(`no account with e-mail ${email}`);
const res = await createApiKeys({ repo: createPostgresApiKeyRepository(db as never) }).issue(user.id, { name, email });
await pool.end();
if (!res.ok) throw new Error(res.error);

const origin = new URL(base).origin;
execFileSync("security", ["add-generic-password", "-U", "-s", "Tachyon CLI", "-a", origin, "-l", `Tachyon CLI (${origin})`, "-w", res.key]);
console.log(`key ${res.view.prefix}… «${res.view.name}» stored in the keychain: service "Tachyon CLI", account ${origin}`);
