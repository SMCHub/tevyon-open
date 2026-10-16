import { Client, StreamableHTTPClientTransport, type OAuthClientProvider } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApiKeys, createMemoryApiKeyRepository } from "../core/api-keys";
import { createMemoryOAuthRepository, createOAuth } from "../core/oauth";
import { createMcpEndpoint } from "./mcp-http";
import { createOAuthHttp } from "./oauth-http";

const BASE = "https://app.tachyon.test";
const MCP_URL = `${BASE}/api/mcp`;
const ACC = "00000000-0000-4000-8000-000000000001";

/** Tachyon in one process: OAuth endpoints, discovery documents and an MCP server that says whom it serves. */
function tachyon() {
  let t = Date.UTC(2026, 9, 13, 12);
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const keys = createApiKeys({ repo: createMemoryApiKeyRepository(), now: clock.now });
  const oauth = createOAuth({ repo: createMemoryOAuthRepository(), keys, now: clock.now });
  const http = createOAuthHttp({ oauth, base: () => BASE });
  const mcp = createMcpEndpoint({
    verify: (token) => (token.startsWith("tca_") ? oauth.verifyAccess(token) : keys.verify(token)),
    resourceMetadataUrl: () => `${BASE}/.well-known/oauth-protected-resource/api/mcp`,
    server: async (principal) => {
      const s = new McpServer({ name: "tachyon", version: "0.0.0" });
      s.registerTool("whoami", { inputSchema: z.object({}) }, async () => ({ content: [{ type: "text", text: `${principal.accountId} via ${principal.kind}` }] }));
      return s;
    },
  });
  const requests: string[] = [];
  async function route(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    requests.push(`${req.method} ${path}`);
    if (path.startsWith("/.well-known/")) return http.wellKnown(req);
    if (path === "/oauth/register") return http.register(req);
    if (path === "/oauth/token") return http.token(req);
    if (path === "/oauth/revoke") return http.revoke(req);
    if (path === "/oauth/device_authorization") return http.deviceAuthorization(req);
    if (path === "/api/mcp") return mcp(req);
    return new Response("Not found", { status: 404 });
  }
  const fetch = (url: string | URL, init?: RequestInit) => route(new Request(url, init));
  return { oauth, keys, clock, fetch, requests };
}

/** An agent's OAuth storage, like Claude Code keeps it. The "browser" is the test itself. */
class AgentProvider implements OAuthClientProvider {
  authUrl?: URL;
  private client?: Parameters<NonNullable<OAuthClientProvider["saveClientInformation"]>>[0];
  private saved?: Parameters<OAuthClientProvider["saveTokens"]>[0];
  private verifier = "";
  private discovery?: unknown;
  get redirectUrl() {
    return "http://localhost:43123/callback";
  }
  get clientMetadata() {
    return { redirect_uris: [this.redirectUrl], client_name: "Test Agent", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
  }
  clientInformation() {
    return this.client;
  }
  saveClientInformation(c: NonNullable<AgentProvider["client"]>) {
    this.client = c;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: NonNullable<AgentProvider["saved"]>) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authUrl = url;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
  saveDiscoveryState(state: unknown) {
    this.discovery = state;
  }
  discoveryState() {
    return this.discovery as never;
  }
}

async function connect(env: ReturnType<typeof tachyon>, provider: AgentProvider) {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: env.fetch, authProvider: provider });
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

/** The user approves in the Studio: what /oauth/authorize does after the consent click. */
async function consent(env: ReturnType<typeof tachyon>, authUrl: URL) {
  const check = await env.oauth.authorizeRequest(Object.fromEntries(authUrl.searchParams), { issuer: BASE, resource: MCP_URL });
  if (!check.ok || !("request" in check)) throw new Error(`authorize failed: ${JSON.stringify(check)}`);
  return new URL(await env.oauth.approve(check.request, { id: ACC, email: "user@example.com" }, { issuer: BASE }));
}

describe("oauth for agents, end to end", () => {
  it("takes an agent from a 401 to a working connection: discovery, registration, consent with PKCE, tokens", async () => {
    const env = tachyon();
    const provider = new AgentProvider();
    const first = new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: env.fetch, authProvider: provider });
    await expect(new Client({ name: "test-agent", version: "1.0.0" }).connect(first)).rejects.toThrow();

    expect(env.requests).toEqual(expect.arrayContaining([
      "POST /api/mcp", "GET /.well-known/oauth-protected-resource/api/mcp", "GET /.well-known/oauth-authorization-server", "POST /oauth/register",
    ]));
    const params = Object.fromEntries(provider.authUrl?.searchParams ?? []);
    expect(`${provider.authUrl?.origin}${provider.authUrl?.pathname}`).toBe(`${BASE}/oauth/authorize`);
    expect(params).toMatchObject({ response_type: "code", code_challenge_method: "S256", client_id: expect.stringMatching(/^tcc_/), resource: MCP_URL, redirect_uri: provider.redirectUrl });

    const callback = await consent(env, provider.authUrl!);
    expect(callback.searchParams.get("iss")).toBe(BASE);
    await first.finishAuth(callback.searchParams);

    const { client } = await connect(env, provider);
    const res = await client.callTool({ name: "whoami", arguments: {} });
    expect(res.content).toEqual([{ type: "text", text: `${ACC} via oauth` }]);
    expect(await env.keys.list(ACC)).toEqual([expect.objectContaining({ name: "Test Agent", kind: "oauth" })]);
  });

  it("refreshes an expired access token by itself, without asking the user again", async () => {
    const env = tachyon();
    const provider = new AgentProvider();
    const first = new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: env.fetch, authProvider: provider });
    await new Client({ name: "a", version: "1" }).connect(first).catch(() => {});
    await first.finishAuth((await consent(env, provider.authUrl!)).searchParams);
    const before = provider.tokens()?.access_token;

    env.clock.advance(3600_000 + 1);
    const { client } = await connect(env, provider);
    expect((await client.callTool({ name: "whoami", arguments: {} })).content).toEqual([{ type: "text", text: `${ACC} via oauth` }]);
    expect(provider.tokens()?.access_token).not.toBe(before);
    expect(env.requests.filter((r) => r === "POST /oauth/token")).toHaveLength(2);
  });

  it("serves the discovery documents with CORS, so browser-based clients can read them", async () => {
    const env = tachyon();
    const prm = await env.fetch(`${BASE}/.well-known/oauth-protected-resource/api/mcp`);
    expect(prm.headers.get("access-control-allow-origin")).toBe("*");
    expect(await prm.json()).toMatchObject({ resource: MCP_URL, authorization_servers: [BASE], scopes_supported: ["tachyon"], resource_name: "Tevyon" });

    const root = await env.fetch(`${BASE}/.well-known/oauth-protected-resource`);
    expect(await root.json()).toMatchObject({ resource: MCP_URL, authorization_servers: [BASE] });

    const as = await (await env.fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
    expect(as).toMatchObject({
      issuer: BASE, authorization_endpoint: `${BASE}/oauth/authorize`, token_endpoint: `${BASE}/oauth/token`, registration_endpoint: `${BASE}/oauth/register`,
      device_authorization_endpoint: `${BASE}/oauth/device_authorization`, code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true,
    });
    expect(as.client_id_metadata_document_supported).toBeUndefined();

    const pre = await env.fetch(`${BASE}/oauth/token`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("answers token errors as OAuth JSON, never cached, and reads client credentials from basic auth", async () => {
    const env = tachyon();
    const reg = await env.fetch(`${BASE}/oauth/register`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" }),
    });
    expect(reg.status).toBe(201);
    const { client_id, client_secret } = await reg.json();

    const res = await env.fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${client_id}:wrong`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "tco_x" }).toString(),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: "invalid_client" });

    const good = await env.fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code: `tco_${"A".repeat(40)}` }).toString(),
    });
    expect(good.status).toBe(400);
    expect(await good.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("starts a CLI device login over HTTP", async () => {
    const env = tachyon();
    const res = await env.fetch(`${BASE}/oauth/device_authorization`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: "tachyon-cli", name: "MacBook" }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verification_uri: `${BASE}/device`, interval: 5 });
  });

  it("answers 429 with Retry-After when an address registers or starts device logins too often, before anything is stored", async () => {
    const oauth = createOAuth({ repo: createMemoryOAuthRepository(), keys: createApiKeys({ repo: createMemoryApiKeyRepository() }) });
    const asked: string[] = [];
    const http = createOAuthHttp({
      oauth,
      base: () => BASE,
      limit: async (req, endpoint) => {
        asked.push(`${endpoint} ${req.headers.get("x-real-ip")}`);
        return { retryAfterSeconds: 42 };
      },
    });
    const register = await http.register(new Request(`${BASE}/oauth/register`, {
      method: "POST", headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
      body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" }),
    }));
    expect(register.status).toBe(429);
    expect(register.headers.get("retry-after")).toBe("42");
    expect(register.headers.get("access-control-allow-origin")).toBe("*");
    expect(await register.json()).toMatchObject({ error: "too_many_requests", retry_after: 42 });
    const device = await http.deviceAuthorization(new Request(`${BASE}/oauth/device_authorization`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-real-ip": "203.0.113.7" }, body: "client_id=tachyon-cli",
    }));
    expect(device.status).toBe(429);
    expect(asked).toEqual(["register 203.0.113.7", "device 203.0.113.7"]);
    // Preflights are never counted.
    expect((await http.register(new Request(`${BASE}/oauth/register`, { method: "OPTIONS" }))).status).toBe(204);
    expect(asked).toHaveLength(2);
  });
});
