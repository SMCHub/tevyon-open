// Applies supabase/migrations/*.sql that are not yet recorded in schema_migrations.
// Usage: node --env-file=.env.local scripts/migrate.ts
// (The Supabase CLI has no rights on this org, so migrations go over DATABASE_URL.)
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
await client.query("alter table schema_migrations enable row level security");
const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
const dir = path.join(import.meta.dirname, "../supabase/migrations");
for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(name)) continue;
  await client.query("begin");
  try {
    await client.query(readFileSync(path.join(dir, name), "utf8"));
    await client.query("insert into schema_migrations (name) values ($1)", [name]);
    await client.query("commit");
    console.log(`applied ${name}`);
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}
console.log("migrations up to date");
await client.end();
