import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ListedMedia, MediaStore } from "@/core/media";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "video/mp4": "mp4" };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));

/** A stored file, ready to be streamed whole or in part (end inclusive), without loading it into memory. */
export type OpenedMedia = {
  size: number;
  contentType: string;
  stream(range?: { start: number; end: number }): ReadableStream<Uint8Array>;
};

/** Development media store on disk (.data/media), served by /api/media. R2 replaces it in production. */
export function createFileMediaStore(root: string): MediaStore & {
  read(key: string): Promise<{ data: Buffer; contentType: string } | undefined>;
  open(key: string): Promise<OpenedMedia | undefined>;
  list(folder: string, limit: number): Promise<ListedMedia[]>;
} {
  /** The file for a key, or undefined if the key points outside the store. */
  function locate(key: string) {
    const full = path.resolve(root, key);
    return full.startsWith(path.resolve(root) + path.sep) ? full : undefined;
  }
  const typeOf = (full: string) => TYPE[path.extname(full).slice(1)] ?? "application/octet-stream";

  return {
    async put(key, data, contentType) {
      const file = `${key}.${EXT[contentType] ?? "bin"}`;
      const full = path.join(root, file);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data);
      return `/api/media/${file}`;
    },
    async read(key) {
      const full = locate(key);
      if (!full) return undefined;
      try {
        return { data: await readFile(full), contentType: typeOf(full) };
      } catch {
        return undefined;
      }
    },
    /** The files directly in a folder (e.g. one account's uploads), newest first. */
    async list(folder, limit) {
      const dir = locate(folder);
      if (!dir) return [];
      const names = await readdir(dir).catch(() => [] as string[]);
      const files = await Promise.all(names.map(async (name) => {
        const info = await stat(path.join(dir, name)).catch(() => undefined);
        const type = typeOf(name);
        if (!info?.isFile() || !/^(image|video)\//.test(type)) return undefined;
        return { url: `/api/media/${folder}/${name}`, kind: type.startsWith("video/") ? "video" as const : "image" as const, at: info.mtimeMs };
      }));
      return files.filter((f): f is ListedMedia => Boolean(f)).sort((a, b) => b.at - a.at).slice(0, limit);
    },
    async open(key) {
      const full = locate(key);
      if (!full) return undefined;
      const info = await stat(full).catch(() => undefined);
      if (!info?.isFile()) return undefined;
      return {
        size: info.size,
        contentType: typeOf(full),
        stream: (range) => Readable.toWeb(createReadStream(full, range)) as ReadableStream<Uint8Array>,
      };
    },
  };
}
