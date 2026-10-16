// Read-only smoke test of the MCP endpoint: connects like an agent, lists the tools and calls the free ones.
// Usage: TACHYON_API_KEY=… node scripts/mcp-smoke.ts [base-url] [--modern]
// Costs nothing: no generate call.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const base = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3100";
const modern = process.argv.includes("--modern");
const key = process.env.TACHYON_API_KEY;
if (!key) throw new Error("TACHYON_API_KEY missing");

const client = new Client({ name: "tachyon-smoke", version: "1.0.0" }, modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", base), { requestInit: { headers: { authorization: `Bearer ${key}` } } }));

const { tools } = await client.listTools();
console.log(`era: ${modern ? "2026-07-28" : "2025"} · ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
for (const [name, args] of [
  ["get_account", {}],
  ["list_models", { kind: "image" }],
  ["get_price", { job_type: "veo_3_1_lite", params: { prompt: "a fox in snow", duration: 4 } }],
  ["list_skills", {}],
  ["list_jobs", { limit: 2 }],
] as const) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
  console.log(`\n${name}${res.isError ? " (error)" : ""}: ${text.slice(0, 400)}${text.length > 400 ? " …" : ""}`);
}
await client.close();
