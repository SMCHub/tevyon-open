import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's "@/…" imports (tsconfig paths), so tests can load route-level modules such as src/proxy.ts.
  resolve: { alias: { "@": path.join(import.meta.dirname, "src") } },
  test: {
    // Postgres tests run on PGlite in-process: the first test of each file builds a migrated database (a 40 MB dump),
    // about 1.5 s alone but over 25 s when several sessions run the suite at once on this machine (load 70+, 13.10.2026).
    testTimeout: 60_000,
    // At most 4 test processes per run (default: one per core, 11 here, ~250 MB each). Several sessions share this
    // Mac and its dev server; unbounded runs pushed the load to 150 and 16 GB into swap, so the Studio hung for everyone.
    maxWorkers: 4,
  },
});
