import { createMcpHandler, type AuthInfo, type McpServer } from "@modelcontextprotocol/server";
import type { ApiKeyPrincipal } from "../core/api-keys";

/**
 * The MCP endpoint over HTTP (POST /api/mcp): checks the Bearer token (API key or OAuth access token), then hands
 * the request to the SDK's handler, which serves both the 2026-07-28 protocol and 2025-era clients (stateless).
 * Never the Studio's login cookie.
 */
export function createMcpEndpoint(deps: {
  verify(token: string): Promise<ApiKeyPrincipal | null>;
  /** A fresh MCP server for one request, acting for this account. */
  server(principal: ApiKeyPrincipal, req: Request): Promise<McpServer>;
  /** RFC 9728 metadata URL for the 401 challenge, so OAuth clients (claude.ai, Claude Code) find the login. */
  resourceMetadataUrl?(req: Request): string;
  onerror?(error: Error): void;
}) {
  const handler = createMcpHandler(
    async ({ authInfo, requestInfo }) => {
      const principal = authInfo?.extra?.principal as ApiKeyPrincipal | undefined;
      if (!principal || !requestInfo) throw new Error("MCP request reached the server without a verified key");
      return deps.server(principal, requestInfo);
    },
    { onerror: deps.onerror ?? ((e) => console.warn("[mcp]", e.message)) },
  );

  return async function serve(req: Request): Promise<Response> {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
    const principal = token ? await deps.verify(token) : null;
    if (!token || !principal) return unauthorized(Boolean(token), deps.resourceMetadataUrl?.(req));
    const authInfo: AuthInfo = { token, clientId: principal.keyId, scopes: [], extra: { principal } };
    return handler.fetch(req, { authInfo });
  };
}

function unauthorized(hadToken: boolean, resourceMetadata?: string): Response {
  const challenge = [`realm="tachyon"`, ...(resourceMetadata ? [`resource_metadata="${resourceMetadata}"`] : []), ...(hadToken ? ['error="invalid_token"'] : [])];
  return Response.json(
    {
      error: "unauthorized",
      message: "Sign in with OAuth, or send a Tevyon API key (Tevyon Studio → “API & MCP”) as Authorization: Bearer <key>.",
    },
    { status: 401, headers: { "www-authenticate": `Bearer ${challenge.join(", ")}` } },
  );
}
