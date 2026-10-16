import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hashKey, randomToken, type ApiKeyPrincipal, type ApiKeys } from "./api-keys";

/**
 * Tachyon's own OAuth 2.1 authorization server for agents (claude.ai connector, Claude Code, Cursor …) and the CLI.
 * - Clients register dynamically (RFC 7591), use the authorization code flow with PKCE S256 only, and get access tokens
 *   (one hour) plus refresh tokens (30 days, rotated, a replay ends the connection, RFC 9700).
 * - A connection is an api_keys row of kind "oauth" (ApiKeys.connect): revoking it in the Studio stops every token.
 * - The CLI logs in with the device flow (RFC 8628) and receives a normal API key.
 * Only hashes of codes, tokens and secrets are stored. Framework-free; the HTTP layer only parses and answers.
 */
export const OAUTH_SCOPE = "tachyon";
export const CLI_CLIENT_ID = "tachyon-cli";
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const CLI_CLIENT_NAME = "Tevyon CLI";
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 24 * 3600;
const CODE_TTL_S = 600;
const DEVICE_TTL_S = 600;
const DEVICE_INTERVAL_S = 5;
const HOUR_MS = 3_600_000;
/**
 * What the daily cleanup removes: codes and device logins an hour after they expired, tokens a day after (until then
 * a replay is still recognised as one), and clients that registered but got no login within a week (spam, abandoned).
 */
const CLEANUP = { expiredCodes: HOUR_MS, expiredDevices: HOUR_MS, expiredTokens: 24 * HOUR_MS, unusedClients: 7 * 24 * HOUR_MS };
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const PATTERN = {
  access: /^tca_[0-9A-Za-z]{40}$/,
  refresh: /^tcr_[0-9A-Za-z]{40}$/,
  code: /^tco_[0-9A-Za-z]{40}$/,
  device: /^tcd_[0-9A-Za-z]{40}$/,
  verifier: /^[A-Za-z0-9._~-]{43,128}$/,
  challenge: /^[A-Za-z0-9_-]{43,128}$/,
};
const BLOCKED_SCHEMES = new Set(["javascript", "data", "file", "vbscript", "about", "blob", "ftp", "ws", "wss"]);

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export type ClientRecord = {
  id: string;
  secretHash?: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  authMethod: AuthMethod;
  createdAt: number;
  /** When the client first got an authorization code. Clients that never did are removed after a week. */
  usedAt?: number;
};

export type CodeRecord = {
  hash: string;
  clientId: string;
  accountId: string;
  email?: string;
  redirectUri: string;
  challenge: string;
  resource?: string;
  scope: string;
  expiresAt: number;
  usedAt?: number;
};

export type TokenRecord = {
  hash: string;
  kind: "access" | "refresh";
  /** The connection (api_keys row of kind "oauth") the token belongs to. */
  grantId: string;
  clientId: string;
  scope: string;
  resource?: string;
  expiresAt: number;
  usedAt?: number;
  revokedAt?: number;
};

export type DeviceStatus = "pending" | "approved" | "denied" | "consumed";

export type DeviceRecord = {
  id: string;
  codeHash: string;
  /** Eight letters without the dash, as stored and compared. */
  userCode: string;
  clientId: string;
  /** Label for the key the CLI receives, e.g. the computer's name. */
  name?: string;
  scope: string;
  interval: number;
  expiresAt: number;
  lastPollAt?: number;
  status: DeviceStatus;
  accountId?: string;
  email?: string;
};

export interface OAuthRepository {
  insertClient(c: ClientRecord): Promise<void>;
  getClient(id: string): Promise<ClientRecord | undefined>;
  insertCode(c: CodeRecord): Promise<void>;
  /** Marks a client as used when it first gets a code; from then on the cleanup keeps it. */
  touchClient(id: string, at: number): Promise<void>;
  /**
   * Deletes codes, device logins and tokens that expired before the given instants, and clients registered before
   * `unusedClients` that never got a code (nor sit behind a connection). Returns how many of each.
   */
  cleanup(before: { codes: number; devices: number; tokens: number; unusedClients: number }): Promise<{ codes: number; devices: number; tokens: number; clients: number }>;
  /** Marks an unused code used and returns it (atomic). An already used code comes back with reused: true. */
  useCode(hash: string, at: number): Promise<{ code: CodeRecord; reused: boolean } | undefined>;
  insertToken(t: TokenRecord): Promise<void>;
  getToken(hash: string): Promise<TokenRecord | undefined>;
  /** Marks an unused refresh token used (atomic). False if it had been used already. */
  useToken(hash: string, at: number): Promise<boolean>;
  revokeToken(hash: string, at: number): Promise<void>;
  /** False if the user code is taken (the caller draws a new one). */
  insertDevice(d: DeviceRecord): Promise<boolean>;
  getDeviceByCode(codeHash: string): Promise<DeviceRecord | undefined>;
  getDeviceByUserCode(userCode: string): Promise<DeviceRecord | undefined>;
  /** Compare-and-set on the status, so two decisions or two polls never both win. */
  updateDevice(id: string, from: DeviceStatus, patch: { status: DeviceStatus; accountId?: string; email?: string }): Promise<boolean>;
  touchDevicePoll(id: string, at: number, interval: number): Promise<void>;
}

export type RegisteredClient = {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at?: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: AuthMethod;
  scope: string;
};

export type RegisterResult =
  | { ok: true; client: RegisteredClient }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

/** A checked authorization request, waiting for the user's consent. */
export type AuthRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  resource?: string;
  state?: string;
};

export type AuthorizeCheck =
  | { ok: true; request: AuthRequest }
  /** An error the client should hear about, sent back to its redirect URI. */
  | { ok: false; redirect: string }
  /** No trustworthy redirect URI: show the error on our own page, never redirect. */
  | { ok: false; error: "invalid_client" | "invalid_redirect_uri"; description: string };

export type TokenResponse = { status: number; body: Record<string, unknown> };
export type Form = Record<string, string | undefined>;
export type BasicAuth = { id: string; secret: string } | null | undefined;

const CLI_CLIENT: ClientRecord = { id: CLI_CLIENT_ID, name: CLI_CLIENT_NAME, redirectUris: [], grantTypes: [DEVICE_GRANT], authMethod: "none", createdAt: 0 };

const fail = (status: number, error: string, description: string): TokenResponse => ({ status, body: { error, error_description: description } });

function sha256url(text: string): string {
  return createHash("sha256").update(text).digest("base64url");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** https anywhere, http only on the loopback (RFC 8252), app schemes like cursor://. Never a fragment or a script. */
export function validRedirectUri(uri: string): boolean {
  if (uri.includes("#") || uri.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  const scheme = u.protocol.slice(0, -1);
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) && !BLOCKED_SCHEMES.has(scheme);
}

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

const trimResource = (r: string) => r.replace(/#.*$/, "").replace(/\/$/, "");

function randomUserCode(): string {
  let code = "";
  while (code.length < 8) {
    for (const b of randomBytes(16)) {
      // 240 = 12 × 20: uniform over the 20 letters.
      if (b < 240) code += USER_CODE_ALPHABET[b % 20];
      if (code.length === 8) break;
    }
  }
  return code;
}

export const formatUserCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
const normalizeUserCode = (input: string) => input.toUpperCase().replace(/[^A-Z]/g, "");

export function createOAuth(deps: { repo: OAuthRepository; keys: ApiKeys; now?: () => number; newId?: () => string }) {
  const { repo, keys, now = Date.now, newId = () => crypto.randomUUID() } = deps;

  async function getClient(id: string): Promise<ClientRecord | undefined> {
    if (id === CLI_CLIENT_ID) return CLI_CLIENT;
    return id.startsWith("tcc_") ? repo.getClient(id) : undefined;
  }

  async function register(input: unknown): Promise<RegisterResult> {
    const meta = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const uris = meta.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every((u) => typeof u === "string" && validRedirectUri(u))) {
      return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must be 1 to 10 https URIs, loopback http URIs or app schemes, without fragments." };
    }
    const method = meta.token_endpoint_auth_method ?? "client_secret_basic";
    if (method !== "none" && method !== "client_secret_post" && method !== "client_secret_basic") {
      return { ok: false, error: "invalid_client_metadata", description: "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic." };
    }
    const grantTypes = Array.isArray(meta.grant_types) ? meta.grant_types : ["authorization_code", "refresh_token"];
    if (!grantTypes.includes("authorization_code") || grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
      return { ok: false, error: "invalid_client_metadata", description: "grant_types may be authorization_code and refresh_token." };
    }
    if (Array.isArray(meta.response_types) && meta.response_types.some((r) => r !== "code")) {
      return { ok: false, error: "invalid_client_metadata", description: "Only response_type code is supported." };
    }
    const name = typeof meta.client_name === "string" && meta.client_name.trim() ? meta.client_name.trim().slice(0, 100) : "App";
    const secret = method === "none" ? undefined : randomToken("tcs_");
    const t = now();
    const record: ClientRecord = {
      id: randomToken("tcc_", 24), name, redirectUris: uris as string[], grantTypes: grantTypes as string[], authMethod: method, createdAt: t,
      ...(secret ? { secretHash: hashKey(secret) } : {}),
    };
    await repo.insertClient(record);
    return {
      ok: true,
      client: {
        client_id: record.id,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(t / 1000),
        client_name: name,
        redirect_uris: record.redirectUris,
        grant_types: record.grantTypes,
        response_types: ["code"],
        token_endpoint_auth_method: method,
        scope: OAUTH_SCOPE,
      },
    };
  }

  async function authorizeRequest(p: Form, ctx: { issuer: string; resource: string }): Promise<AuthorizeCheck> {
    const client = await getClient(p.client_id ?? "");
    if (!client || !client.grantTypes.includes("authorization_code")) return { ok: false, error: "invalid_client", description: "This app is not registered with Tevyon." };
    const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      return { ok: false, error: "invalid_redirect_uri", description: "The redirect address does not belong to this app." };
    }
    const back = (error: string, description: string): AuthorizeCheck => ({
      ok: false, redirect: withParams(redirectUri, { error, error_description: description, state: p.state, iss: ctx.issuer }),
    });
    if (p.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
    if (!p.code_challenge || !PATTERN.challenge.test(p.code_challenge) || p.code_challenge_method !== "S256") {
      return back("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.");
    }
    const scopes = (p.scope ?? OAUTH_SCOPE).split(" ").filter(Boolean);
    if (scopes.some((s) => s !== OAUTH_SCOPE)) return back("invalid_scope", `The only scope is "${OAUTH_SCOPE}".`);
    if (p.resource && trimResource(p.resource) !== trimResource(ctx.resource)) return back("invalid_target", `The resource must be ${ctx.resource}.`);
    return {
      ok: true,
      request: {
        clientId: client.id, clientName: client.name, redirectUri, challenge: p.code_challenge, scope: OAUTH_SCOPE, resource: ctx.resource,
        ...(p.state ? { state: p.state } : {}),
      },
    };
  }

  /** The user said yes: a single-use code for the client, sent to its redirect URI with state and iss (RFC 9207). */
  async function approve(req: AuthRequest, account: { id: string; email?: string }, ctx: { issuer: string }): Promise<string> {
    const code = randomToken("tco_");
    await repo.insertCode({
      hash: hashKey(code), clientId: req.clientId, accountId: account.id, redirectUri: req.redirectUri, challenge: req.challenge,
      scope: req.scope, expiresAt: now() + CODE_TTL_S * 1000,
      ...(account.email ? { email: account.email } : {}), ...(req.resource ? { resource: req.resource } : {}),
    });
    await repo.touchClient(req.clientId, now());
    return withParams(req.redirectUri, { code, state: req.state, iss: ctx.issuer });
  }

  function deny(req: AuthRequest, ctx: { issuer: string }): string {
    return withParams(req.redirectUri, { error: "access_denied", error_description: "The user did not allow access.", state: req.state, iss: ctx.issuer });
  }

  async function authenticate(form: Form, basic: BasicAuth): Promise<{ ok: true; client: ClientRecord } | { ok: false; res: TokenResponse }> {
    const bad = { ok: false as const, res: fail(401, "invalid_client", "Client authentication failed.") };
    if (basic) {
      if (form.client_id && form.client_id !== basic.id) return bad;
      const client = await getClient(basic.id);
      if (!client || client.authMethod !== "client_secret_basic" || !client.secretHash || !sameText(hashKey(basic.secret), client.secretHash)) return bad;
      return { ok: true, client };
    }
    const client = await getClient(form.client_id ?? "");
    if (!client) return bad;
    if (client.authMethod === "none") return form.client_secret ? bad : { ok: true, client };
    if (client.authMethod !== "client_secret_post" || !form.client_secret || !client.secretHash || !sameText(hashKey(form.client_secret), client.secretHash)) return bad;
    return { ok: true, client };
  }

  async function issueTokens(grantId: string, clientId: string, scope: string, resource?: string): Promise<TokenResponse> {
    const access = randomToken("tca_");
    const refresh = randomToken("tcr_");
    const t = now();
    const base = { grantId, clientId, scope, ...(resource ? { resource } : {}) };
    await repo.insertToken({ ...base, hash: hashKey(access), kind: "access", expiresAt: t + ACCESS_TTL_S * 1000 });
    await repo.insertToken({ ...base, hash: hashKey(refresh), kind: "refresh", expiresAt: t + REFRESH_TTL_S * 1000 });
    return { status: 200, body: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope } };
  }

  async function codeGrant(client: ClientRecord, form: Form): Promise<TokenResponse> {
    const invalid = (d: string) => fail(400, "invalid_grant", d);
    if (!client.grantTypes.includes("authorization_code")) return fail(400, "unauthorized_client", "This client may not use authorization codes.");
    const raw = form.code ?? "";
    if (!PATTERN.code.test(raw)) return invalid("Unknown code.");
    const used = await repo.useCode(hashKey(raw), now());
    if (!used) return invalid("Unknown code.");
    const { code, reused } = used;
    if (reused) {
      // A code presented twice means someone else may hold it: end whatever it created (RFC 6749 §4.1.2).
      await keys.disconnect(code.accountId, code.clientId);
      return invalid("This code was already used.");
    }
    if (code.clientId !== client.id) return invalid("The code belongs to another client.");
    if (code.expiresAt <= now()) return invalid("The code has expired.");
    const redirect = form.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (redirect !== code.redirectUri) return invalid("redirect_uri does not match the authorization request.");
    const verifier = form.code_verifier ?? "";
    if (!PATTERN.verifier.test(verifier) || !sameText(sha256url(verifier), code.challenge)) return invalid("The PKCE code_verifier does not match.");
    if (form.resource && code.resource && trimResource(form.resource) !== trimResource(code.resource)) return fail(400, "invalid_target", "The resource does not match.");
    const con = await keys.connect(code.accountId, { name: client.name, clientId: client.id, ...(code.email ? { email: code.email } : {}) });
    if (!con.ok) return invalid("The account has too many active keys and connections. Remove one in Tevyon Studio.");
    return issueTokens(con.id, client.id, code.scope, code.resource);
  }

  async function refreshGrant(client: ClientRecord, form: Form): Promise<TokenResponse> {
    const invalid = () => fail(400, "invalid_grant", "The refresh token is invalid, expired or revoked.");
    const raw = form.refresh_token ?? "";
    if (!PATTERN.refresh.test(raw)) return invalid();
    const hash = hashKey(raw);
    const token = await repo.getToken(hash);
    if (!token || token.kind !== "refresh" || token.clientId !== client.id || token.revokedAt !== undefined || token.expiresAt <= now()) return invalid();
    const principal = await keys.principal(token.grantId);
    if (!principal) return invalid();
    if (!(await repo.useToken(hash, now()))) {
      // Rotation: every refresh token works once. A second use means it leaked; end the connection (RFC 9700 §4.14).
      await keys.revoke(principal.accountId, token.grantId);
      return invalid();
    }
    return issueTokens(token.grantId, client.id, token.scope, token.resource);
  }

  async function deviceGrant(client: ClientRecord, form: Form): Promise<TokenResponse> {
    if (!client.grantTypes.includes(DEVICE_GRANT)) return fail(400, "unauthorized_client", "This client may not use the device flow.");
    const raw = form.device_code ?? "";
    const d = PATTERN.device.test(raw) ? await repo.getDeviceByCode(hashKey(raw)) : undefined;
    if (!d || d.clientId !== client.id || d.status === "consumed") return fail(400, "invalid_grant", "Unknown or used device code.");
    const t = now();
    if (d.expiresAt <= t) return fail(400, "expired_token", "The login took too long. Run tevyon login again.");
    if (d.status === "denied") return fail(400, "access_denied", "The login was declined in Tevyon Studio.");
    if (d.status === "pending") {
      if (d.lastPollAt !== undefined && t - d.lastPollAt < d.interval * 1000) {
        await repo.touchDevicePoll(d.id, t, d.interval + 5);
        return fail(400, "slow_down", "Polling too fast.");
      }
      await repo.touchDevicePoll(d.id, t, d.interval);
      return fail(400, "authorization_pending", "Waiting for the confirmation in Tevyon Studio.");
    }
    if (!d.accountId || !(await repo.updateDevice(d.id, "approved", { status: "consumed" }))) return fail(400, "invalid_grant", "Unknown or used device code.");
    const res = await keys.issue(d.accountId, { name: `${CLI_CLIENT_NAME}${d.name ? ` · ${d.name}` : ""}`, ...(d.email ? { email: d.email } : {}) });
    if (!res.ok) return fail(400, "invalid_grant", "The account has too many active keys. Remove one in Tevyon Studio.");
    return { status: 200, body: { access_token: res.key, token_type: "Bearer", scope: d.scope } };
  }

  async function token(form: Form, basic?: BasicAuth): Promise<TokenResponse> {
    const auth = await authenticate(form, basic);
    if (!auth.ok) return auth.res;
    switch (form.grant_type) {
      case "authorization_code":
        return codeGrant(auth.client, form);
      case "refresh_token":
        return refreshGrant(auth.client, form);
      case DEVICE_GRANT:
        return deviceGrant(auth.client, form);
      default:
        return fail(400, "unsupported_grant_type", "Use authorization_code, refresh_token or the device code grant.");
    }
  }

  /** RFC 7009: always 200 for unknown tokens. A refresh token ends its connection, an access token only itself. */
  async function revoke(form: Form, basic?: BasicAuth): Promise<TokenResponse> {
    const auth = await authenticate(form, basic);
    if (!auth.ok) return auth.res;
    const raw = form.token ?? "";
    if (!raw) return fail(400, "invalid_request", "token is missing.");
    if (PATTERN.refresh.test(raw) || PATTERN.access.test(raw)) {
      const hash = hashKey(raw);
      const t = await repo.getToken(hash);
      if (t && t.clientId === auth.client.id) {
        if (t.kind === "access") await repo.revokeToken(hash, now());
        else {
          const principal = await keys.principal(t.grantId);
          if (principal) await keys.revoke(principal.accountId, t.grantId);
        }
      }
    }
    return { status: 200, body: {} };
  }

  /** The account an access token acts for, or null (unknown, expired, revoked, connection ended). */
  async function verifyAccess(raw: string): Promise<ApiKeyPrincipal | null> {
    if (!PATTERN.access.test(raw)) return null;
    const t = await repo.getToken(hashKey(raw));
    if (!t || t.kind !== "access" || t.revokedAt !== undefined || t.expiresAt <= now()) return null;
    const principal = await keys.principal(t.grantId);
    return principal && principal.kind === "oauth" ? principal : null;
  }

  async function deviceAuthorize(form: Form, ctx: { issuer: string }): Promise<TokenResponse> {
    const client = await getClient(form.client_id ?? "");
    if (!client) return fail(401, "invalid_client", "Unknown client.");
    if (!client.grantTypes.includes(DEVICE_GRANT)) return fail(400, "unauthorized_client", "This client may not use the device flow.");
    const scopes = (form.scope ?? OAUTH_SCOPE).split(" ").filter(Boolean);
    if (scopes.some((s) => s !== OAUTH_SCOPE)) return fail(400, "invalid_scope", `The only scope is "${OAUTH_SCOPE}".`);
    const deviceCode = randomToken("tcd_");
    const name = typeof form.name === "string" ? form.name.trim().slice(0, 40) : "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const userCode = randomUserCode();
      const inserted = await repo.insertDevice({
        id: newId(), codeHash: hashKey(deviceCode), userCode, clientId: client.id, scope: OAUTH_SCOPE, interval: DEVICE_INTERVAL_S,
        expiresAt: now() + DEVICE_TTL_S * 1000, status: "pending", ...(name ? { name } : {}),
      });
      if (!inserted) continue;
      const shown = formatUserCode(userCode);
      return {
        status: 200,
        body: {
          device_code: deviceCode, user_code: shown, verification_uri: `${ctx.issuer}/device`,
          verification_uri_complete: `${ctx.issuer}/device?code=${shown}`, expires_in: DEVICE_TTL_S, interval: DEVICE_INTERVAL_S,
        },
      };
    }
    return fail(500, "server_error", "Could not create a login code. Try again.");
  }

  async function findDevice(input: string) {
    const code = normalizeUserCode(input);
    return code.length === 8 ? repo.getDeviceByUserCode(code) : undefined;
  }

  /** What the confirmation page shows for a typed code. */
  async function deviceLookup(input: string): Promise<{ ok: true; device: { userCode: string; clientName: string; name?: string } } | { ok: false; error: "not_found" | "expired" | "used" }> {
    const d = await findDevice(input);
    if (!d) return { ok: false, error: "not_found" };
    if (d.status !== "pending") return { ok: false, error: "used" };
    if (d.expiresAt <= now()) return { ok: false, error: "expired" };
    const client = await getClient(d.clientId);
    return { ok: true, device: { userCode: formatUserCode(d.userCode), clientName: client?.name ?? CLI_CLIENT_NAME, ...(d.name ? { name: d.name } : {}) } };
  }

  /** The signed-in user confirms or declines a pending login. Binds it to that account. */
  async function deviceDecide(input: string, account: { id: string; email?: string }, allow: boolean): Promise<boolean> {
    const d = await findDevice(input);
    if (!d || d.status !== "pending" || d.expiresAt <= now()) return false;
    return repo.updateDevice(d.id, "pending", allow ? { status: "approved", accountId: account.id, ...(account.email ? { email: account.email } : {}) } : { status: "denied" });
  }

  /** The daily cleanup (cron): what expired or was registered and never used goes. */
  async function cleanup() {
    const t = now();
    return repo.cleanup({
      codes: t - CLEANUP.expiredCodes, devices: t - CLEANUP.expiredDevices, tokens: t - CLEANUP.expiredTokens, unusedClients: t - CLEANUP.unusedClients,
    });
  }

  return { register, authorizeRequest, approve, deny, token, revoke, verifyAccess, deviceAuthorize, deviceLookup, deviceDecide, cleanup };
}

export type OAuth = ReturnType<typeof createOAuth>;

export function createMemoryOAuthRepository(): OAuthRepository {
  const clients = new Map<string, ClientRecord>();
  const codes = new Map<string, CodeRecord>();
  const tokens = new Map<string, TokenRecord>();
  const devices = new Map<string, DeviceRecord>();
  const copy = <T extends object>(x: T | undefined): T | undefined => (x ? structuredClone(x) : undefined);
  return {
    async insertClient(c) {
      clients.set(c.id, structuredClone(c));
    },
    async getClient(id) {
      return copy(clients.get(id));
    },
    async insertCode(c) {
      codes.set(c.hash, structuredClone(c));
    },
    async touchClient(id, at) {
      const c = clients.get(id);
      if (c && c.usedAt === undefined) c.usedAt = at;
    },
    async cleanup(before) {
      const drop = <T>(map: Map<string, T>, gone: (x: T) => boolean) => {
        let n = 0;
        for (const [k, x] of map) if (gone(x)) (map.delete(k), n++);
        return n;
      };
      return {
        codes: drop(codes, (c) => c.expiresAt < before.codes),
        devices: drop(devices, (d) => d.expiresAt < before.devices),
        tokens: drop(tokens, (t) => t.expiresAt < before.tokens),
        clients: drop(clients, (c) => c.usedAt === undefined && c.createdAt < before.unusedClients),
      };
    },
    async useCode(hash, at) {
      const c = codes.get(hash);
      if (!c) return undefined;
      if (c.usedAt !== undefined) return { code: structuredClone(c), reused: true };
      c.usedAt = at;
      return { code: structuredClone(c), reused: false };
    },
    async insertToken(t) {
      tokens.set(t.hash, structuredClone(t));
    },
    async getToken(hash) {
      return copy(tokens.get(hash));
    },
    async useToken(hash, at) {
      const t = tokens.get(hash);
      if (!t || t.usedAt !== undefined) return false;
      t.usedAt = at;
      return true;
    },
    async revokeToken(hash, at) {
      const t = tokens.get(hash);
      if (t && t.revokedAt === undefined) t.revokedAt = at;
    },
    async insertDevice(d) {
      if ([...devices.values()].some((x) => x.userCode === d.userCode)) return false;
      devices.set(d.id, structuredClone(d));
      return true;
    },
    async getDeviceByCode(codeHash) {
      return copy([...devices.values()].find((d) => d.codeHash === codeHash));
    },
    async getDeviceByUserCode(userCode) {
      return copy([...devices.values()].find((d) => d.userCode === userCode));
    },
    async updateDevice(id, from, patch) {
      const d = devices.get(id);
      if (!d || d.status !== from) return false;
      Object.assign(d, patch);
      return true;
    },
    async touchDevicePoll(id, at, interval) {
      const d = devices.get(id);
      if (d) {
        d.lastPollAt = at;
        d.interval = interval;
      }
    },
  };
}
