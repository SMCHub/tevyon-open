import type { ListedMedia, MediaStore } from "@/core/media";
import type { OpenedMedia } from "./file-media";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "video/mp4": "mp4" };

/**
 * Media store in Supabase Storage (private bucket «media»), for production on Vercel, where the file system is
 * read-only. Same keys and URLs as the file store (/api/media/<key>.<ext>), so jobs, links and the media route do not
 * change. Only the server talks to Storage, with the secret key; browsers keep loading through /api/media.
 */
export function createSupabaseMediaStore(opts: { url: string; secretKey: string; bucket?: string; fetch?: typeof fetch }): MediaStore & {
  read(key: string): Promise<{ data: Buffer; contentType: string } | undefined>;
  open(key: string): Promise<OpenedMedia | undefined>;
  list(folder: string, limit: number): Promise<ListedMedia[]>;
  signedUrl(mediaUrl: string, seconds: number): Promise<string | undefined>;
} {
  const bucket = opts.bucket ?? "media";
  const doFetch = opts.fetch ?? fetch;
  const base = `${opts.url.replace(/\/$/, "")}/storage/v1/object/${bucket}`;
  const auth = { apikey: opts.secretKey, authorization: `Bearer ${opts.secretKey}` };
  /** A key we may touch: relative, without "..", empty or absolute parts. */
  const safe = (key: string) => key.length > 0 && !key.startsWith("/") && key.split("/").every((p) => p && p !== "." && p !== "..");
  const objectUrl = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

  return {
    async put(key, data, contentType) {
      const file = `${key}.${EXT[contentType] ?? "bin"}`;
      if (!safe(file)) throw new Error("storage upload failed: invalid key");
      const res = await doFetch(objectUrl(file), {
        method: "POST",
        headers: { ...auth, "content-type": contentType, "x-upsert": "true", "cache-control": "max-age=31536000" },
        body: data as unknown as BodyInit,
      });
      if (!res.ok) throw new Error(`storage upload failed: ${res.status}`);
      return `/api/media/${file}`;
    },
    /**
     * A short-lived https link to one stored file (Storage sign API). The vendor takes video inputs only over https
     * (15.10.2026: «Only HTTPS URLs are allowed»), and a local server has no public address of its own.
     */
    async signedUrl(mediaUrl, seconds) {
      const key = mediaUrl.replace(/^\/api\/media\//, "");
      if (!safe(key)) return undefined;
      const res = await doFetch(`${opts.url.replace(/\/$/, "")}/storage/v1/object/sign/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ expiresIn: seconds }),
      }).catch(() => undefined);
      if (!res?.ok) return undefined;
      const body = (await res.json().catch(() => ({}))) as { signedURL?: string };
      return body.signedURL ? `${opts.url.replace(/\/$/, "")}/storage/v1${body.signedURL}` : undefined;
    },
    /** The files directly in a folder (e.g. one account's uploads), newest first (Storage list API). */
    async list(folder, limit) {
      if (!safe(folder)) return [];
      const res = await doFetch(`${opts.url.replace(/\/$/, "")}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ prefix: folder, limit, offset: 0, sortBy: { column: "created_at", order: "desc" } }),
      });
      if (!res.ok) return [];
      const rows = (await res.json()) as { name?: string; created_at?: string; metadata?: { mimetype?: string } | null }[];
      return rows.flatMap((r) => {
        const type = r.metadata?.mimetype ?? "";
        if (!r.name || !/^(image|video)\//.test(type)) return [];
        return [{ url: `/api/media/${folder}/${r.name}`, kind: type.startsWith("video/") ? "video" as const : "image" as const, at: Date.parse(r.created_at ?? "") || 0 }];
      });
    },
    async read(key) {
      if (!safe(key)) return undefined;
      const res = await doFetch(objectUrl(key), { headers: auth });
      if (!res.ok) return undefined;
      return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    },
    async open(key) {
      if (!safe(key)) return undefined;
      const head = await doFetch(objectUrl(key), { method: "HEAD", headers: auth });
      const size = Number(head.headers.get("content-length"));
      if (!head.ok || !Number.isFinite(size)) return undefined;
      const contentType = head.headers.get("content-type") ?? "application/octet-stream";
      return {
        size,
        contentType,
        // Fetched lazily when the response is read; a range asks Storage for just that slice.
        stream: (range) => {
          const body = doFetch(objectUrl(key), { headers: { ...auth, ...(range ? { range: `bytes=${range.start}-${range.end}` } : {}) } });
          return new ReadableStream<Uint8Array>({
            async start(controller) {
              const res = await body;
              if (!res.ok || !res.body) return controller.error(new Error(`storage read failed: ${res.status}`));
              const reader = res.body.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
              }
              controller.close();
            },
          });
        },
      };
    },
  };
}
