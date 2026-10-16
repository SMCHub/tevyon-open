import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Where the CLI keeps the API key, one per Tevyon server (origin).
 * macOS: the keychain (service "Tevyon CLI", account = origin). Elsewhere: a 0600 JSON file in the config folder.
 * TEVYON_API_KEY (or the old TACHYON_API_KEY) in the environment always wins and is never stored.
 * Keys saved before the rename (service "Tachyon CLI", folder «tachyon») are still found until a new one is saved.
 */
export interface KeyStore {
  readonly where: "keychain" | "file";
  readonly path?: string;
  get(origin: string): Promise<string | undefined>;
  set(origin: string, key: string): Promise<void>;
  delete(origin: string): Promise<boolean>;
}

const SERVICE = "Tevyon CLI";
const LEGACY_SERVICE = "Tachyon CLI";

function security(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile("security", args, (error, stdout) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout) });
    });
  });
}

export function keychainStore(service = SERVICE): KeyStore {
  return {
    where: "keychain",
    async get(origin) {
      const { code, stdout } = await security(["find-generic-password", "-s", service, "-a", origin, "-w"]);
      return code === 0 && stdout.trim() ? stdout.trim() : undefined;
    },
    async set(origin, key) {
      const { code } = await security(["add-generic-password", "-U", "-s", service, "-a", origin, "-l", `${service} (${origin})`, "-w", key]);
      if (code !== 0) throw new Error("keychain_write_failed");
    },
    async delete(origin) {
      return (await security(["delete-generic-password", "-s", service, "-a", origin])).code === 0;
    },
  };
}

export function fileStore(file: string): KeyStore {
  async function load(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }
  async function save(all: Record<string, string>) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    await chmod(file, 0o600);
  }
  return {
    where: "file",
    path: file,
    async get(origin) {
      return (await load())[origin];
    },
    async set(origin, key) {
      await save({ ...(await load()), [origin]: key });
    },
    async delete(origin) {
      const all = await load();
      if (!(origin in all)) return false;
      delete all[origin];
      await save(all);
      return true;
    },
  };
}

/**
 * The store under the current name, falling back to the one from before the rename: reads find an old key, saving
 * writes the new place only, logout clears both.
 */
export function withLegacy(primary: KeyStore, legacy: KeyStore): KeyStore {
  return {
    where: primary.where,
    ...(primary.path ? { path: primary.path } : {}),
    async get(origin) {
      return (await primary.get(origin)) ?? (await legacy.get(origin));
    },
    set: (origin, key) => primary.set(origin, key),
    async delete(origin) {
      const removed = await primary.delete(origin);
      const removedOld = await legacy.delete(origin);
      return removed || removedOld;
    },
  };
}

export function systemKeyStore(env: Record<string, string | undefined>, platform = process.platform): KeyStore {
  if (platform === "darwin") return withLegacy(keychainStore(SERVICE), keychainStore(LEGACY_SERVICE));
  const config = env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
  return withLegacy(fileStore(path.join(config, "tevyon", "credentials.json")), fileStore(path.join(config, "tachyon", "credentials.json")));
}
