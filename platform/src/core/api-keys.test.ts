import { describe, expect, it } from "vitest";
import { createApiKeys, DEFAULT_DAILY_LIMIT, MAX_ACTIVE_KEYS } from "./api-keys";
import { apiKeyRepositories } from "./testing/api-key-repositories";

const ACC_1 = "00000000-0000-4000-8000-000000000001";
const ACC_2 = "00000000-0000-4000-8000-000000000002";

describe.each(apiKeyRepositories)("api keys on %s repository", (_name, makeRepo) => {
  async function setup() {
    let t = Date.UTC(2026, 9, 13, 12, 0, 0);
    const clock = { now: () => t, advance: (ms: number) => (t += ms) };
    const keys = createApiKeys({ repo: await makeRepo(), now: clock.now });
    return { keys, clock };
  }

  describe("issue", () => {
    it("hands out a tch_ key once and lists it only by its prefix", async () => {
      const { keys } = await setup();
      const res = await keys.issue(ACC_1, { name: "Claude Code", email: "user@example.com" });
      if (!res.ok) throw new Error(res.error);

      expect(res.key).toMatch(/^tch_[0-9A-Za-z]{40}$/);
      expect(res.view).toMatchObject({ name: "Claude Code", prefix: res.key.slice(0, 10), lastUsedAt: null });
      const listed = await keys.list(ACC_1);
      expect(listed).toEqual([res.view]);
      expect(JSON.stringify(listed)).not.toContain(res.key);
    });

    it("never hands out the same key twice", async () => {
      const { keys } = await setup();
      const a = await keys.issue(ACC_1, { name: "a" });
      const b = await keys.issue(ACC_1, { name: "b" });
      if (!a.ok || !b.ok) throw new Error("issue failed");
      expect(a.key).not.toBe(b.key);
    });

    it("rejects an empty or overlong name", async () => {
      const { keys } = await setup();
      expect(await keys.issue(ACC_1, { name: "   " })).toEqual({ ok: false, error: "invalid_name" });
      expect(await keys.issue(ACC_1, { name: "x".repeat(61) })).toEqual({ ok: false, error: "invalid_name" });
    });

    it("caps the number of active keys per account", async () => {
      const { keys } = await setup();
      for (let i = 0; i < MAX_ACTIVE_KEYS; i++) expect((await keys.issue(ACC_1, { name: `k${i}` })).ok).toBe(true);
      expect(await keys.issue(ACC_1, { name: "one too many" })).toEqual({ ok: false, error: "too_many_keys" });
      expect((await keys.issue(ACC_2, { name: "other account" })).ok).toBe(true);
    });
  });

  describe("verify", () => {
    it("resolves a valid key to its account", async () => {
      const { keys } = await setup();
      const res = await keys.issue(ACC_1, { name: "CLI", email: "user@example.com" });
      if (!res.ok) throw new Error(res.error);
      expect(await keys.verify(res.key)).toEqual({ accountId: ACC_1, keyId: res.view.id, email: "user@example.com", kind: "key", dailyLimit: DEFAULT_DAILY_LIMIT });
    });

    it("rejects unknown, malformed and tampered keys", async () => {
      const { keys } = await setup();
      const res = await keys.issue(ACC_1, { name: "CLI" });
      if (!res.ok) throw new Error(res.error);
      const flipped = res.key.slice(0, -1) + (res.key.endsWith("a") ? "b" : "a");
      for (const bad of ["", "tch_", "Bearer x", "sk_live_123", flipped, res.key + "x"]) {
        expect(await keys.verify(bad)).toBeNull();
      }
    });

    it("records when a key was last used, at most every few minutes", async () => {
      const { keys, clock } = await setup();
      const res = await keys.issue(ACC_1, { name: "CLI" });
      if (!res.ok) throw new Error(res.error);

      await keys.verify(res.key);
      const first = (await keys.list(ACC_1))[0]?.lastUsedAt;
      expect(first).toBe(clock.now());

      clock.advance(60_000);
      await keys.verify(res.key);
      expect((await keys.list(ACC_1))[0]?.lastUsedAt).toBe(first);

      clock.advance(10 * 60_000);
      await keys.verify(res.key);
      expect((await keys.list(ACC_1))[0]?.lastUsedAt).toBe(clock.now());
    });
  });

  describe("revoke", () => {
    it("stops a revoked key from working and hides it from the list", async () => {
      const { keys } = await setup();
      const res = await keys.issue(ACC_1, { name: "CLI" });
      if (!res.ok) throw new Error(res.error);

      expect(await keys.revoke(ACC_1, res.view.id)).toBe(true);
      expect(await keys.verify(res.key)).toBeNull();
      expect(await keys.list(ACC_1)).toEqual([]);
      expect(await keys.revoke(ACC_1, res.view.id)).toBe(false);
    });

    it("only lets the owner revoke a key", async () => {
      const { keys } = await setup();
      const res = await keys.issue(ACC_1, { name: "CLI" });
      if (!res.ok) throw new Error(res.error);

      expect(await keys.revoke(ACC_2, res.view.id)).toBe(false);
      expect(await keys.verify(res.key)).not.toBeNull();
    });

    it("frees a slot under the cap", async () => {
      const { keys } = await setup();
      const ids: string[] = [];
      for (let i = 0; i < MAX_ACTIVE_KEYS; i++) {
        const r = await keys.issue(ACC_1, { name: `k${i}` });
        if (r.ok) ids.push(r.view.id);
      }
      await keys.revoke(ACC_1, ids[0]!);
      expect((await keys.issue(ACC_1, { name: "replacement" })).ok).toBe(true);
    });
  });

  describe("daily limit", () => {
    it("gives every new key the default limit, which the owner can change or switch off", async () => {
      const { keys } = await setup();
      const res = await keys.issue(ACC_1, { name: "CLI" });
      if (!res.ok) throw new Error(res.error);
      expect(DEFAULT_DAILY_LIMIT).toBe(300);
      expect(res.view.dailyLimit).toBe(300);

      expect(await keys.setDailyLimit(ACC_1, res.view.id, 50)).toBe(true);
      expect((await keys.verify(res.key))?.dailyLimit).toBe(50);
      expect(await keys.setDailyLimit(ACC_1, res.view.id, null)).toBe(true);
      expect((await keys.verify(res.key))?.dailyLimit).toBeNull();
      expect((await keys.list(ACC_1))[0]?.dailyLimit).toBeNull();
    });

    it("only lets the owner set a sensible limit", async () => {
      const { keys } = await setup();
      const res = await keys.issue(ACC_1, { name: "CLI" });
      if (!res.ok) throw new Error(res.error);
      expect(await keys.setDailyLimit(ACC_2, res.view.id, 10)).toBe(false);
      for (const bad of [0, -5, 2.5, 10_000_001]) expect(await keys.setDailyLimit(ACC_1, res.view.id, bad)).toBe(false);
      expect((await keys.verify(res.key))?.dailyLimit).toBe(300);
    });
  });

  describe("oauth connections", () => {
    it("lists a connection next to the keys and resolves it to its account", async () => {
      const { keys } = await setup();
      const con = await keys.connect(ACC_1, { name: "Claude", clientId: "tcc_claude", email: "user@example.com" });
      if (!con.ok) throw new Error(con.error);
      expect(await keys.list(ACC_1)).toEqual([expect.objectContaining({ id: con.id, name: "Claude", kind: "oauth", dailyLimit: 300 })]);
      expect(await keys.principal(con.id)).toEqual({ accountId: ACC_1, keyId: con.id, email: "user@example.com", kind: "oauth", dailyLimit: 300 });
    });

    it("reuses the connection when the same client is authorised again", async () => {
      const { keys } = await setup();
      const a = await keys.connect(ACC_1, { name: "Claude", clientId: "tcc_claude" });
      const b = await keys.connect(ACC_1, { name: "Claude", clientId: "tcc_claude" });
      const other = await keys.connect(ACC_2, { name: "Claude", clientId: "tcc_claude" });
      if (!a.ok || !b.ok || !other.ok) throw new Error("connect failed");
      expect(b.id).toBe(a.id);
      expect(other.id).not.toBe(a.id);
      expect(await keys.list(ACC_1)).toHaveLength(1);
    });

    it("stops a revoked connection and never lets a key lookup find it", async () => {
      const { keys } = await setup();
      const con = await keys.connect(ACC_1, { name: "Claude", clientId: "tcc_claude" });
      if (!con.ok) throw new Error(con.error);
      expect(await keys.revoke(ACC_1, con.id)).toBe(true);
      expect(await keys.principal(con.id)).toBeNull();
      const again = await keys.connect(ACC_1, { name: "Claude", clientId: "tcc_claude" });
      if (!again.ok) throw new Error(again.error);
      expect(again.id).not.toBe(con.id);
    });

    it("counts connections against the same cap as keys", async () => {
      const { keys } = await setup();
      for (let i = 0; i < MAX_ACTIVE_KEYS; i++) await keys.issue(ACC_1, { name: `k${i}` });
      expect(await keys.connect(ACC_1, { name: "Claude", clientId: "tcc_claude" })).toEqual({ ok: false, error: "too_many_keys" });
    });
  });

  it("lists the account's keys newest first, never another account's", async () => {
    const { keys, clock } = await setup();
    await keys.issue(ACC_1, { name: "old" });
    clock.advance(1000);
    await keys.issue(ACC_1, { name: "new" });
    await keys.issue(ACC_2, { name: "foreign" });
    expect((await keys.list(ACC_1)).map((k) => k.name)).toEqual(["new", "old"]);
  });
});
