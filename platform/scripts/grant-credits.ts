// Manual credit grant (showcase jobs, goodwill): ref admin:<reason>:<day>, shown as an adjustment in the statement,
// never as revenue. Without --yes it only shows what it would book.
// Usage: node --env-file=.env.local scripts/grant-credits.ts <email> <credits> <reason> [--yes]
import path from "node:path";
import { runnerImport } from "vite";

const root = path.join(import.meta.dirname, "..");
const { module } = await runnerImport<{ main(argv: string[]): Promise<number> }>(
  path.join(root, "src/server/grant-credits-cli.ts"),
  { configFile: false, logLevel: "error", root },
);
process.exitCode = await module.main(process.argv.slice(2));
