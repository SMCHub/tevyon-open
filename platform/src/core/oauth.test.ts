import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApiKeys } from "./api-keys";
import { CLI_CLIENT_ID, createOAuth } from "./oauth";
import { oauthRepositories } from "./testing/oauth-repositories";

const ACC = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const ISSUER = "https://app.tachyon.test";
const RESOURCE = `${ISSUER}/api/mcp`;
const CTX = { issuer: ISSUER, resource: RESOURCE };
const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const b64url = (b: Buffer) => b.toString("base64url");
function pkce() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

describe.each(oauthRepositories)("oauth on %s repositories", (_name, makeRepos) => {
  async function setup() {
    let t = Date.UTC(2026, 9, 13, 12);
    const clock = { now: () => t, advance: (ms: number) => (t += ms) };
    const repos = await makeRepos();
    const keys = createApiKeys({ repo: repos.keys, now: clock.now });
    const oauth = createOAuth({ repo: repos.oauth, keys, now: clock.now });

    async function client(meta: Record<string, unknown> = {}) {
      const res = await oauth.register({ redirect_uris: [CLAUDE_CB], client_name: "Claude", token_endpoint_auth_method: "none", ...meta });
      if (!res.ok) throw new Error(res.description);
      return res.client;
    }

    /** Authorize, consent as ACC and return the code and everything the token request needs. */
    async function authorized(clientId: string, extra: Record<string, string> = {}) {
      const { verifier, challenge } = pkce();
      const check = await oauth.authorizeRequest(
        { response_type: "code", client_id: clientId, redirect_uri: CLAUDE_CB, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "tachyon", resource: RESOURCE, ...extra },
        CTX,
      );
      if (!check.ok || !("request" in check)) throw new Error(JSON.stringify(check));
      const redirect = new URL(await oauth.approve(check.request, { id: ACC, email: "user@example.com" }, CTX));
      return { code: redirect.searchParams.get("code") ?? "", verifier, redirect };
    }

    async function exchange(clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) {
      return oauth.token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CLAUDE_CB, client_id: clientId, resource: RESOURCE, ...extra });
    }

    return { oauth, keys, clock, client, authorized, exchange };
  }

  describe("register", () => {
    it("registers a public client and hands back its client_id", async () => {
      const { oauth } = await setup();
      const res = await oauth.register({ redirect_uris: [CLAUDE_CB], client_name: "Claude", token_endpoint_auth_method: "none" });
      expect(res).toMatchObject({
        ok: true,
        client: { client_id: expect.stringMatching(/^tcc_[0-9A-Za-z]{24}$/), client_name: "Claude", redirect_uris: [CLAUDE_CB], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
      });
      if (res.ok) expect(res.client.client_secret).toBeUndefined();
    });

    it("gives a confidential client a secret once, client_secret_basic being the default", async () => {
      const { oauth } = await setup();
      const res = await oauth.register({ redirect_uris: [CLAUDE_CB] });
      expect(res).toMatchObject({ ok: true, client: { token_endpoint_auth_method: "client_secret_basic", client_secret: expect.stringMatching(/^tcs_/), client_secret_expires_at: 0 } });
    });

    it("accepts https, loopback http and app schemes as redirect URIs, nothing else", async () => {
      const { oauth } = await setup();
      for (const uri of ["https://x.example/cb", "http://localhost:4567/callback", "http://127.0.0.1:9/cb", "http://[::1]:9/cb", "cursor://anysphere.cursor-mcp/oauth/callback"]) {
        expect((await oauth.register({ redirect_uris: [uri], token_endpoint_auth_method: "none" })).ok).toBe(true);
      }
      for (const uris of [["http://evil.example/cb"], ["javascript:alert(1)"], ["https://x.example/cb#frag"], ["not a url"], [], ["data:text/html,x"]]) {
        expect(await oauth.register({ redirect_uris: uris, token_endpoint_auth_method: "none" })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
      }
    });
  });

  describe("authorize", () => {
    it("turns a valid request into a consent request with the client's name", async () => {
      const { oauth, client } = await setup();
      const c = await client();
      const { challenge } = pkce();
      const check = await oauth.authorizeRequest({ response_type: "code", client_id: c.client_id, redirect_uri: CLAUDE_CB, code_challenge: challenge, code_challenge_method: "S256", state: "s1" }, CTX);
      expect(check).toEqual({ ok: true, request: { clientId: c.client_id, clientName: "Claude", redirectUri: CLAUDE_CB, challenge, scope: "tachyon", resource: RESOURCE, state: "s1" } });
    });

    it("shows an error page, never a redirect, for an unknown client or a foreign redirect URI", async () => {
      const { oauth, client } = await setup();
      const c = await client();
      const { challenge } = pkce();
      const base = { response_type: "code", code_challenge: challenge, code_challenge_method: "S256" };
      expect(await oauth.authorizeRequest({ ...base, client_id: "tcc_unknown", redirect_uri: CLAUDE_CB }, CTX)).toMatchObject({ ok: false, error: "invalid_client" });
      expect(await oauth.authorizeRequest({ ...base, client_id: c.client_id, redirect_uri: "https://evil.example/cb" }, CTX)).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    });

    it("sends other errors back to the client once its redirect URI is known", async () => {
      const { oauth, client } = await setup();
      const c = await client();
      const { challenge } = pkce();
      const base = { response_type: "code", client_id: c.client_id, redirect_uri: CLAUDE_CB, code_challenge: challenge, code_challenge_method: "S256", state: "st" };
      const cases: [Record<string, string | undefined>, string][] = [
        [{ code_challenge: undefined }, "invalid_request"],
        [{ code_challenge_method: "plain" }, "invalid_request"],
        [{ scope: "admin" }, "invalid_scope"],
        [{ resource: "https://other.example/mcp" }, "invalid_target"],
        [{ response_type: "token" }, "unsupported_response_type"],
      ];
      for (const [change, error] of cases) {
        const check = await oauth.authorizeRequest({ ...base, ...change }, CTX);
        if (check.ok || !("redirect" in check)) throw new Error(`expected a redirect for ${error}`);
        const url = new URL(check.redirect);
        expect(`${url.origin}${url.pathname}`).toBe(CLAUDE_CB);
        expect(Object.fromEntries(url.searchParams)).toMatchObject({ error, state: "st", iss: ISSUER });
      }
    });
  });

  describe("code exchange", () => {
    it("exchanges the code once for an access and a refresh token that act for the account", async () => {
      const { oauth, keys, client, authorized, exchange } = await setup();
      const c = await client();
      const { code, verifier, redirect } = await authorized(c.client_id);
      expect(redirect.searchParams.get("state")).toBe("xyz");
      expect(redirect.searchParams.get("iss")).toBe(ISSUER);

      const res = await exchange(c.client_id, code, verifier);
      expect(res).toEqual({
        status: 200,
        body: { access_token: expect.stringMatching(/^tca_/), refresh_token: expect.stringMatching(/^tcr_/), token_type: "Bearer", expires_in: 3600, scope: "tachyon" },
      });
      const principal = await oauth.verifyAccess(String(res.body.access_token));
      expect(principal).toMatchObject({ accountId: ACC, email: "user@example.com", kind: "oauth", dailyLimit: 300 });
      expect(await keys.list(ACC)).toEqual([expect.objectContaining({ id: principal?.keyId, name: "Claude", kind: "oauth" })]);
    });

    it("refuses a wrong code verifier, another redirect URI or another client", async () => {
      const { client, authorized, exchange } = await setup();
      const c = await client();
      const other = await client({ redirect_uris: ["https://other.example/cb"] });
      for (const [args, clientId] of [
        [{ code_verifier: pkce().verifier }, c.client_id],
        [{ redirect_uri: "https://other.example/cb" }, c.client_id],
        [{}, other.client_id],
      ] as const) {
        const { code, verifier } = await authorized(c.client_id);
        expect(await exchange(clientId, code, verifier, args)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
      }
    });

    it("never accepts a code twice, and a replay ends the connection", async () => {
      const { oauth, client, authorized, exchange } = await setup();
      const c = await client();
      const { code, verifier } = await authorized(c.client_id);
      const first = await exchange(c.client_id, code, verifier);
      expect(await exchange(c.client_id, code, verifier)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
      expect(await oauth.verifyAccess(String(first.body.access_token))).toBeNull();
    });

    it("lets a code expire after ten minutes", async () => {
      const { client, authorized, exchange, clock } = await setup();
      const c = await client();
      const { code, verifier } = await authorized(c.client_id);
      clock.advance(10 * 60_000 + 1);
      expect(await exchange(c.client_id, code, verifier)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    });

    it("authenticates confidential clients by basic auth or in the form, and refuses a wrong secret", async () => {
      const { oauth, client, authorized } = await setup();
      const basic = await client({ token_endpoint_auth_method: "client_secret_basic" });
      const post = await client({ token_endpoint_auth_method: "client_secret_post" });

      const a = await authorized(basic.client_id);
      const form = { grant_type: "authorization_code", code: a.code, code_verifier: a.verifier, redirect_uri: CLAUDE_CB };
      expect(await oauth.token(form, { id: basic.client_id, secret: "tcs_wrong" })).toMatchObject({ status: 401, body: { error: "invalid_client" } });
      expect(await oauth.token({ ...form, client_id: basic.client_id })).toMatchObject({ status: 401, body: { error: "invalid_client" } });
      const b = await authorized(basic.client_id);
      expect((await oauth.token({ ...form, code: b.code, code_verifier: b.verifier }, { id: basic.client_id, secret: String(basic.client_secret) })).status).toBe(200);

      const p = await authorized(post.client_id);
      expect((await oauth.token({ ...form, code: p.code, code_verifier: p.verifier, client_id: post.client_id, client_secret: String(post.client_secret) })).status).toBe(200);
    });

    it("keeps one connection when the same client is authorised again", async () => {
      const { keys, client, authorized, exchange } = await setup();
      const c = await client();
      for (let i = 0; i < 2; i++) {
        const { code, verifier } = await authorized(c.client_id);
        await exchange(c.client_id, code, verifier);
      }
      expect(await keys.list(ACC)).toHaveLength(1);
    });
  });

  describe("tokens", () => {
    async function connected() {
      const s = await setup();
      const c = await s.client();
      const { code, verifier } = await s.authorized(c.client_id);
      const res = await s.exchange(c.client_id, code, verifier);
      return { ...s, c, access: String(res.body.access_token), refresh: String(res.body.refresh_token) };
    }
    const refreshWith = (s: Awaited<ReturnType<typeof connected>>, token: string) =>
      s.oauth.token({ grant_type: "refresh_token", refresh_token: token, client_id: s.c.client_id });

    it("lets an access token run out after an hour", async () => {
      const s = await connected();
      s.clock.advance(3600_000 + 1);
      expect(await s.oauth.verifyAccess(s.access)).toBeNull();
    });

    it("rotates on refresh: the new pair works, the old refresh token does not", async () => {
      const s = await connected();
      const next = await refreshWith(s, s.refresh);
      expect(next).toMatchObject({ status: 200, body: { access_token: expect.stringMatching(/^tca_/), refresh_token: expect.stringMatching(/^tcr_/) } });
      expect(next.body.refresh_token).not.toBe(s.refresh);
      expect(await s.oauth.verifyAccess(String(next.body.access_token))).toMatchObject({ accountId: ACC });
    });

    it("ends the whole connection when an old refresh token comes back", async () => {
      const s = await connected();
      const next = await refreshWith(s, s.refresh);
      expect(await refreshWith(s, s.refresh)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
      expect(await s.oauth.verifyAccess(String(next.body.access_token))).toBeNull();
      expect(await refreshWith(s, String(next.body.refresh_token))).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    });

    it("stops every token of a connection that was disconnected in the Studio", async () => {
      const s = await connected();
      const id = (await s.oauth.verifyAccess(s.access))?.keyId ?? "";
      expect(await s.keys.revoke(ACC, id)).toBe(true);
      expect(await s.oauth.verifyAccess(s.access)).toBeNull();
      expect(await refreshWith(s, s.refresh)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    });

    it("ends the connection when the client revokes its refresh token (RFC 7009)", async () => {
      const s = await connected();
      await s.oauth.revoke({ token: s.refresh, token_type_hint: "refresh_token", client_id: s.c.client_id });
      expect(await s.oauth.verifyAccess(s.access)).toBeNull();
      expect(await refreshWith(s, s.refresh)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    });

    it("never lets another client refresh a token or a random string pass", async () => {
      const s = await connected();
      const other = await s.client();
      expect(await s.oauth.token({ grant_type: "refresh_token", refresh_token: s.refresh, client_id: other.client_id })).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
      expect(await s.oauth.verifyAccess("tca_" + "x".repeat(40))).toBeNull();
      expect(await s.oauth.verifyAccess(s.refresh)).toBeNull();
    });
  });

  describe("device flow for the CLI", () => {
    async function device(name = "MacBook") {
      const s = await setup();
      const res = await s.oauth.deviceAuthorize({ client_id: CLI_CLIENT_ID, name }, CTX);
      const poll = () => s.oauth.token({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: String(res.body.device_code), client_id: CLI_CLIENT_ID });
      return { ...s, res, poll, userCode: String(res.body.user_code) };
    }

    it("logs the CLI in: a code, the confirmation in the Studio, then a key for the CLI", async () => {
      const d = await device();
      expect(d.res).toEqual({
        status: 200,
        body: {
          device_code: expect.stringMatching(/^tcd_/), user_code: expect.stringMatching(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/),
          verification_uri: `${ISSUER}/device`, verification_uri_complete: `${ISSUER}/device?code=${d.userCode}`, expires_in: 600, interval: 5,
        },
      });
      expect(await d.poll()).toMatchObject({ status: 400, body: { error: "authorization_pending" } });

      const typed = d.userCode.toLowerCase().replace("-", " ");
      expect(await d.oauth.deviceLookup(typed)).toEqual({ ok: true, device: { userCode: d.userCode, clientName: "Tevyon CLI", name: "MacBook" } });
      expect(await d.oauth.deviceDecide(typed, { id: ACC, email: "user@example.com" }, true)).toBe(true);

      d.clock.advance(5000);
      const done = await d.poll();
      expect(done).toMatchObject({ status: 200, body: { access_token: expect.stringMatching(/^tch_/), token_type: "Bearer", scope: "tachyon" } });
      expect(await d.keys.verify(String(done.body.access_token))).toMatchObject({ accountId: ACC, kind: "key" });
      expect((await d.keys.list(ACC))[0]?.name).toBe("Tevyon CLI · MacBook");

      d.clock.advance(5000);
      expect(await d.poll()).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
      expect(await d.oauth.deviceLookup(d.userCode)).toEqual({ ok: false, error: "used" });
    });

    it("asks a CLI that polls too fast to slow down", async () => {
      const d = await device();
      await d.poll();
      expect(await d.poll()).toMatchObject({ status: 400, body: { error: "slow_down" } });
      d.clock.advance(10_000);
      expect(await d.poll()).toMatchObject({ status: 400, body: { error: "authorization_pending" } });
    });

    it("gives the CLI a clear answer when the login was denied or ran out", async () => {
      const denied = await device();
      await denied.oauth.deviceDecide(denied.userCode, { id: ACC }, false);
      denied.clock.advance(5000);
      expect(await denied.poll()).toMatchObject({ status: 400, body: { error: "access_denied" } });

      const late = await device();
      late.clock.advance(600_000 + 1);
      expect(await late.poll()).toMatchObject({ status: 400, body: { error: "expired_token" } });
      expect(await late.oauth.deviceLookup(late.userCode)).toEqual({ ok: false, error: "expired" });
      expect(await late.oauth.deviceDecide(late.userCode, { id: ACC }, true)).toBe(false);
    });

    it("only offers the device flow to the CLI's own client", async () => {
      const s = await setup();
      const c = await s.client();
      expect(await s.oauth.deviceAuthorize({ client_id: c.client_id }, CTX)).toMatchObject({ status: 400, body: { error: "unauthorized_client" } });
      expect(await s.oauth.deviceAuthorize({ client_id: "nope" }, CTX)).toMatchObject({ status: 401, body: { error: "invalid_client" } });
      expect(await s.oauth.deviceLookup("ABCD-EFGH")).toEqual({ ok: false, error: "not_found" });
    });

    it("binds an approved login to the approving account only", async () => {
      const d = await device();
      await d.oauth.deviceDecide(d.userCode, { id: OTHER }, true);
      expect(await d.oauth.deviceDecide(d.userCode, { id: ACC }, true)).toBe(false);
      d.clock.advance(5000);
      const done = await d.poll();
      expect(await d.keys.verify(String(done.body.access_token))).toMatchObject({ accountId: OTHER });
    });
  });

  describe("cleanup", () => {
    it("removes codes, device logins and tokens that can no longer be used, and keeps what still works", async () => {
      const { oauth, clock, client, authorized, exchange } = await setup();
      const c = await client();
      const first = await authorized(c.client_id);
      const tokens = await exchange(c.client_id, first.code, first.verifier);
      expect(tokens.status).toBe(200);
      await authorized(c.client_id); // a second code nobody exchanges
      await oauth.deviceAuthorize({ client_id: CLI_CLIENT_ID, name: "Laptop" }, CTX); // a CLI login nobody confirms

      clock.advance(2 * HOUR);
      expect(await oauth.cleanup()).toEqual({ codes: 2, devices: 1, tokens: 0, clients: 0 });
      // The access token ended an hour after it was issued and goes a day later; the refresh token lives on.
      clock.advance(DAY);
      expect(await oauth.cleanup()).toEqual({ codes: 0, devices: 0, tokens: 1, clients: 0 });
      const refreshed = await oauth.token({ grant_type: "refresh_token", refresh_token: String(tokens.body.refresh_token), client_id: c.client_id });
      expect(refreshed.status).toBe(200);
    });

    it("removes clients that registered but never got a login within a week, and keeps those in use", async () => {
      const { oauth, clock, client, authorized } = await setup();
      const unused = await client({ client_name: "Never logged in" });
      const used = await client();
      await authorized(used.client_id);
      clock.advance(6 * DAY);
      expect((await oauth.cleanup()).clients).toBe(0);
      clock.advance(2 * DAY);
      expect((await oauth.cleanup()).clients).toBe(1);
      const ask = (clientId: string) => oauth.authorizeRequest(
        { response_type: "code", client_id: clientId, redirect_uri: CLAUDE_CB, code_challenge: pkce().challenge, code_challenge_method: "S256", scope: "tachyon", resource: RESOURCE },
        CTX,
      );
      expect(await ask(unused.client_id)).toMatchObject({ ok: false });
      expect(await ask(used.client_id)).toMatchObject({ ok: true });
    });
  });
});
