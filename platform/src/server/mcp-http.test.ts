import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ApiKeyPrincipal } from "../core/api-keys";
import { createMcpEndpoint } from "./mcp-http";

const KEY = "tch_" + "a".repeat(40);
const URL_ = "https://app.tachyon.test/api/mcp";
const PRINCIPAL = { accountId: "acc-1", keyId: "key-1", email: "user@example.com", kind: "key" as const, dailyLimit: 300 };

/** A tiny server that tells which account the request was served for. */
function endpoint() {
  const seen: { principal: ApiKeyPrincipal; origin: string }[] = [];
  const serve = createMcpEndpoint({
    verify: async (token) => (token === KEY ? PRINCIPAL : null),
    resourceMetadataUrl: (req) => `${new URL(req.url).origin}/.well-known/oauth-protected-resource/api/mcp`,
    server: async (principal, req) => {
      seen.push({ principal, origin: new URL(req.url).origin });
      const s = new McpServer({ name: "tachyon", version: "0.0.0" });
      s.registerTool("whoami", { inputSchema: z.object({}) }, async () => ({
        content: [{ type: "text", text: principal.accountId }],
      }));
      return s;
    },
  });
  return { serve, seen };
}

async function connect(serve: (req: Request) => Promise<Response>, opts: { token?: string; modern?: boolean } = {}) {
  const transport = new StreamableHTTPClientTransport(new URL(URL_), {
    fetch: (url, init) => serve(new Request(url, init)),
    ...(opts.token ? { requestInit: { headers: { authorization: `Bearer ${opts.token}` } } } : {}),
  });
  const client = new Client(
    { name: "test-agent", version: "1.0.0" },
    opts.modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
  );
  await client.connect(transport);
  return client;
}

describe("mcp endpoint", () => {
  it("serves a 2025-era client that sends a valid key, as that key's account", async () => {
    const { serve, seen } = endpoint();
    const client = await connect(serve, { token: KEY });
    const res = await client.callTool({ name: "whoami", arguments: {} });
    expect(res.content).toEqual([{ type: "text", text: "acc-1" }]);
    expect(seen.at(-1)).toEqual({ principal: PRINCIPAL, origin: "https://app.tachyon.test" });
  });

  it("serves a 2026-07-28 client the same way", async () => {
    const { serve } = endpoint();
    const client = await connect(serve, { token: KEY, modern: true });
    const res = await client.callTool({ name: "whoami", arguments: {} });
    expect(res.content).toEqual([{ type: "text", text: "acc-1" }]);
  });

  it("answers 401 with a Bearer challenge when the key is missing or wrong, before any server is built", async () => {
    const { serve, seen } = endpoint();
    const variants: Record<string, string>[] = [{}, { authorization: "Bearer tch_wrong" }, { authorization: `Basic ${KEY}` }];
    for (const headers of variants) {
      const res = await serve(new Request(URL_, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer realm="tachyon", resource_metadata="https:\/\/app\.tachyon\.test\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
      expect(await res.json()).toMatchObject({ error: "unauthorized" });
    }
    expect(seen).toEqual([]);
    await expect(connect(serve)).rejects.toThrow();
  });
});
