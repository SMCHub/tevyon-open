// Community moderation: list reported and hidden creations and profiles, hide one (its owner sees the reason) or restore
// it, and forget an account's community data (a deletion request under the DSG). Without --yes nothing changes.
// Usage: node --env-file=.env.local scripts/community.ts list | hide <job-id|@handle> <reason> [--yes]
//        | unhide <job-id|@handle> [--yes] | forget <email> [--yes]
import path from "node:path";
import { runnerImport } from "vite";

const root = path.join(import.meta.dirname, "..");
const { module } = await runnerImport<{ main(argv: string[]): Promise<number> }>(
  path.join(root, "src/server/community-cli.ts"),
  { configFile: false, logLevel: "error", root },
);
process.exitCode = await module.main(process.argv.slice(2));
