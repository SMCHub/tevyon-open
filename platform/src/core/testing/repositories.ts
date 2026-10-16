import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach } from "vitest";
import { createPostgresRepository, type Db } from "../postgres-repository";
import { createMemoryRepository, type JobRepository } from "../repository";

const MIGRATIONS = path.join(import.meta.dirname, "../../../supabase/migrations");

/**
 * Every test gets its own database, and each holds the whole data directory (about 40 MB) in memory. Closed after
 * each test instead of whenever the garbage collector gets to it: with several sessions running the suite at once,
 * the open ones pushed this machine into swap (13.10.2026).
 */
const open = new Set<PGlite>();
afterEach(async () => {
  const dbs = [...open];
  open.clear();
  await Promise.all(dbs.map((pg) => pg.close().catch(() => {})));
});

/** One migrated database per test worker; every test gets a clone of it (migrating per test got too slow). */
let template: Promise<File | Blob> | null = null;
function migratedTemplate() {
  template ??= (async () => {
    const pg = new PGlite();
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      await pg.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
    }
    const dump = await pg.dumpDataDir("none");
    await pg.close();
    return dump;
  })();
  return template;
}

/** A fresh in-process Postgres with all migrations applied. */
export async function pgliteDb(): Promise<Db> {
  const pg = new PGlite({ loadDataDir: await migratedTemplate() });
  open.add(pg);
  return {
    query: async (sql, params) => (await pg.query(sql, params)).rows as never,
    tx: (fn) => pg.transaction((t) => fn(async (sql, params) => (await t.query(sql, params)).rows as never)),
  };
}

/** Every repository implementation runs the same job tests. `now` sets the clock for credits that expire. */
export const repositories: [string, (opts?: { now?: () => number }) => Promise<JobRepository>][] = [
  ["memory", async (opts) => createMemoryRepository(opts)],
  ["postgres", async (opts) => createPostgresRepository(await pgliteDb(), opts)],
];
