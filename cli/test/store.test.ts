import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileStore, withLegacy } from "../src/store.ts";

const ORIGIN = "http://localhost:3100";

async function stores() {
  const dir = await mkdtemp(path.join(tmpdir(), "tevyon-store-"));
  const now = fileStore(path.join(dir, "tevyon", "credentials.json"));
  const old = fileStore(path.join(dir, "tachyon", "credentials.json"));
  return { dir, now, old, both: withLegacy(now, old) };
}

describe("key store across the rename", () => {
  it("finds a key stored under the old name until a new one is saved", async () => {
    const { old, both } = await stores();
    await old.set(ORIGIN, "tch_old");
    expect(await both.get(ORIGIN)).toBe("tch_old");
  });

  it("saves under the new name only, and the new key wins", async () => {
    const { dir, old, both } = await stores();
    await old.set(ORIGIN, "tch_old");
    await both.set(ORIGIN, "tch_new");
    expect(await both.get(ORIGIN)).toBe("tch_new");
    expect(JSON.parse(await readFile(path.join(dir, "tevyon", "credentials.json"), "utf8"))).toEqual({ [ORIGIN]: "tch_new" });
  });

  it("logout removes the key under both names", async () => {
    const { now, old, both } = await stores();
    await old.set(ORIGIN, "tch_old");
    await now.set(ORIGIN, "tch_new");
    expect(await both.delete(ORIGIN)).toBe(true);
    expect(await both.get(ORIGIN)).toBeUndefined();
    expect(await both.delete(ORIGIN)).toBe(false);
  });

  it("keeps the primary's place for messages", async () => {
    const { now, both } = await stores();
    expect(both.where).toBe("file");
    expect(both.path).toBe(now.path);
  });
});
