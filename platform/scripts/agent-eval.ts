// Agent evals with a real language model (src/server/agent-eval-cli.ts): the model plays an agent against Tevyon's MCP
// server in process (real catalog, a vendor that finishes at once, test credits); every session is judged by the house
// rules. Without --yes it only shows the scenarios and the estimated token cost (free). With --yes the model's tokens
// cost money (Comfy Router chat route); the generations do not.
// Usage: node --env-file=.env.local scripts/agent-eval.ts [--yes] [--model claude-sonnet-5-5] [--scenario video-with-sound,product-photo]
import path from "node:path";
import { runnerImport } from "vite";

const root = path.join(import.meta.dirname, "..");
const { module } = await runnerImport<{ main(argv: string[], opts: { root: string }): Promise<number> }>(
  path.join(root, "src/server/agent-eval-cli.ts"),
  // The Director modules the MCP server imports use the app's "@/…" paths.
  { configFile: false, logLevel: "error", root, resolve: { alias: { "@": path.join(root, "src") } } },
);
process.exitCode = await module.main(process.argv.slice(2), { root });
