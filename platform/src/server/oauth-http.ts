import { buildOAuthProtectedResourceMetadata, oauthMetadataResponse, type AuthMetadataOptions } from "@modelcontextprotocol/server";
import { DEVICE_GRANT, OAUTH_SCOPE, type BasicAuth, type Form, type OAuth, type TokenResponse } from "../core/oauth";

/**
 * The HTTP face of Tachyon's OAuth server, framework-free (Next.js routes are one-line wrappers):
 * discovery documents (RFC 9728, RFC 8414), registration (RFC 7591), token, revocation (RFC 7009) and the
 * device authorization endpoint (RFC 8628). The consent pages live in the app, they need the Studio session.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "86400",
};
const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"];

function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { ...CORS, "cache-control": "no-store", pragma: "no-cache" } });
}

const preflight = () => new Response(null, { status: 204, headers: CORS });

function tooMany(retryAfterSeconds: number): Response {
  const res = reply(429, { error: "too_many_requests", error_description: `Too many requests. Try again in ${retryAfterSeconds} seconds.`, retry_after: retryAfterSeconds });
  res.headers.set("retry-after", String(retryAfterSeconds));
  return res;
}
const fromToken = (r: TokenResponse) => reply(r.status, r.body);

/** RFC 8414 metadata of this authorization server. The issuer is the origin the request came to. */
export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token", DEVICE_GRANT],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/settings/api`,
  };
}

const loopback = (origin: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);

function metadataOptions(issuer: string): AuthMetadataOptions {
  return {
    oauthMetadata: authorizationServerMetadata(issuer),
    resourceServerUrl: new URL(`${issuer}/api/mcp`),
    serviceDocumentationUrl: new URL(`${issuer}/settings/api`),
    scopesSupported: [OAUTH_SCOPE],
    resourceName: "Tevyon",
    // http is fine on the developer's own machine only; anywhere else the issuer must be https.
    ...(loopback(issuer) ? { dangerouslyAllowInsecureIssuerUrl: true } : {}),
  };
}

async function readForm(req: Request): Promise<Form> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (type.includes("application/json")) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === "string")) as Form;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** Client credentials from "Authorization: Basic …" (RFC 6749 §2.3.1: both parts form-encoded before base64). */
function basicAuth(req: Request): BasicAuth {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m?.[1]) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  try {
    return { id: decodeURIComponent(decoded.slice(0, i).replace(/\+/g, " ")), secret: decodeURIComponent(decoded.slice(i + 1).replace(/\+/g, " ")) };
  } catch {
    return null;
  }
}

export function createOAuthHttp(deps: {
  oauth: OAuth;
  base(req: Request): string;
  /** Rate limits for the open endpoints that store something (registration, device login): null = go on. */
  limit?(req: Request, endpoint: "register" | "device"): Promise<{ retryAfterSeconds: number } | null>;
}) {
  const { oauth } = deps;

  return {
    /** GET /.well-known/oauth-protected-resource[/api/mcp] and /.well-known/oauth-authorization-server. */
    async wellKnown(req: Request): Promise<Response> {
      if (req.method === "OPTIONS") return preflight();
      const issuer = deps.base(req);
      const options = metadataOptions(issuer);
      const served = oauthMetadataResponse(req, options);
      if (served) return served;
      // Older clients ask for the document at the root, without the resource path.
      if (new URL(req.url).pathname === "/.well-known/oauth-protected-resource") return reply(200, buildOAuthProtectedResourceMetadata(options));
      return reply(404, { error: "not_found" });
    },

    async register(req: Request): Promise<Response> {
      if (req.method === "OPTIONS") return preflight();
      const blocked = await deps.limit?.(req, "register");
      if (blocked) return tooMany(blocked.retryAfterSeconds);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return reply(400, { error: "invalid_client_metadata", error_description: "The body must be JSON." });
      }
      const res = await oauth.register(body);
      return res.ok ? reply(201, res.client) : reply(400, { error: res.error, error_description: res.description });
    },

    async token(req: Request): Promise<Response> {
      if (req.method === "OPTIONS") return preflight();
      return fromToken(await oauth.token(await readForm(req), basicAuth(req)));
    },

    async revoke(req: Request): Promise<Response> {
      if (req.method === "OPTIONS") return preflight();
      return fromToken(await oauth.revoke(await readForm(req), basicAuth(req)));
    },

    async deviceAuthorization(req: Request): Promise<Response> {
      if (req.method === "OPTIONS") return preflight();
      const blocked = await deps.limit?.(req, "device");
      if (blocked) return tooMany(blocked.retryAfterSeconds);
      return fromToken(await oauth.deviceAuthorize(await readForm(req), { issuer: deps.base(req) }));
    },
  };
}
