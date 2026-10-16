// OAuth smoke test like an agent with a loopback redirect (Claude Code works this way): registers a client, prints the
// authorize URL, waits for the browser to come back, exchanges the code (PKCE) and calls get_account over MCP.
// Usage: node scripts/oauth-smoke.ts [base-url] [--keep]
//   --keep leaves the connection in place (visible under «API & MCP»); without it the script ends it again.
// Prints no token. Costs nothing.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const base = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3100";
const keep = process.argv.includes("--keep");
const b64url = (b: Buffer) => b.toString("base64url");

const server = createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const redirectUri = `http://127.0.0.1:${port}/callback`;

const reg = await fetch(`${base}/oauth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Tachyon OAuth-Test", token_endpoint_auth_method: "none" }),
});
if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${await reg.text()}`);
const { client_id } = (await reg.json()) as { client_id: string };

const verifier = b64url(randomBytes(48));
const state = b64url(randomBytes(12));
const auth = new URL(`${base}/oauth/authorize`);
for (const [k, v] of Object.entries({
  response_type: "code", client_id, redirect_uri: redirectUri, code_challenge: b64url(createHash("sha256").update(verifier).digest()),
  code_challenge_method: "S256", state, scope: "tachyon", resource: `${base}/api/mcp`,
})) auth.searchParams.set(k, v);
console.log(`AUTHORIZE_URL ${auth}`);

const callback = await new Promise<URLSearchParams>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("no callback within 5 minutes")), 300_000);
  server.on("request", (req, res) => {
    const url = new URL(req.url ?? "/", redirectUri);
    if (url.pathname !== "/callback") return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<p style='font:16px system-ui'>Tachyon OAuth-Test: Rücksprung angekommen. Du kannst den Tab schliessen.</p>");
    clearTimeout(timer);
    resolve(url.searchParams);
  });
});
server.close();
if (callback.get("error")) throw new Error(`authorization refused: ${callback.get("error")}`);
if (callback.get("state") !== state) throw new Error("state mismatch");
if (callback.get("iss") !== base) throw new Error(`iss mismatch: ${callback.get("iss")}`);

const tok = await fetch(`${base}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code: callback.get("code") ?? "", code_verifier: verifier, redirect_uri: redirectUri, client_id, resource: `${base}/api/mcp` }),
});
const tokens = (await tok.json()) as { access_token?: string; refresh_token?: string; error?: string };
if (!tokens.access_token) throw new Error(`token exchange failed: ${tokens.error}`);
console.log("token exchange ok (access and refresh token received, not shown)");

const client = new Client({ name: "tachyon-oauth-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", base), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
const res = await client.callTool({ name: "get_account", arguments: {} });
const account = (res as { structuredContent?: { email?: string; credits?: number } }).structuredContent;
console.log(`MCP over OAuth ok: ${account?.email} · ${account?.credits} credits`);
await client.close();

if (!keep) {
  await fetch(`${base}/oauth/revoke`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: tokens.refresh_token ?? "", token_type_hint: "refresh_token", client_id }),
  });
  console.log("connection ended again (revoked)");
}
