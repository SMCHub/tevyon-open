import type { Provider, ProviderFailure, ProviderOutput, ProviderResult } from "../provider";

/**
 * Provider adapter for the Comfy Router (Comfy Developer Platform): one queue for many hosted models, addressed as
 * `{provider}/{model}`. Submit: POST /v2/models/{provider}/{model}/requests with the model's own JSON input → request_id.
 * Status: GET …/requests/{id}/status until COMPLETED (a failure is a completion with an `error_type`). Result: GET
 * …/requests/{id}, the model's own JSON; every media URL in it is downloaded into our storage.
 * Same contract as every provider (provider.ts): what surely did not reach the router throws and the worker retries;
 * once a job may have been queued, a lost answer is final, because sending it again could bill it twice.
 */
export const COMFY_ROUTER = "https://api.comfy.org";
/** Comfy's asset store: the router takes video inputs only as links, so our videos go here first (signed, about 6 h). */
export const COMFY_ASSETS = "https://cloud.comfy.org";

/** The asset store did not take the file: nothing was queued yet, so the worker may simply try again. */
class AssetUploadFailed extends Error {}

export type ComfyTimeouts = { submit: number; poll: number; download: number };
const TIMEOUTS: ComfyTimeouts = { submit: 60_000, poll: 30_000, download: 180_000 };

/** Busy or down, nothing queued: asking again is safe. */
const isBusy = (status: number) => status >= 500 || status === 408 || status === 429;
/** Our account (key, credits, access): retrying cannot fix it. */
const isAccount = (status: number) => status === 401 || status === 402 || status === 403;

/** Connection errors before a single byte reached the router. */
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const neverSent = (e: unknown) => {
  const code = (e as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return typeof code === "string" && NOT_SENT.has(code);
};
const isTimeout = (e: unknown) => e instanceof Error && e.name === "TimeoutError";
const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** The router's error buckets in our own failure codes; the router's text stays in `detail` (server-only). */
function failure(errorType: string): ProviderFailure {
  if (errorType === "content_policy_violation") return "moderated";
  if (errorType === "invalid_input" || errorType === "model_not_found") return "invalid_request";
  if (errorType === "provider_timeout" || errorType === "deadline_exceeded" || errorType === "queue_timeout") return "timeout";
  return "provider_error";
}

/** The markers catalog.ts puts where a model wants a file in another shape than a data URL. */
const MARKERS = { $inlineBase64: "veo", $rawBase64: "raw", $inlineData: "gemini", $assetLink: "asset" } as const;

/** Our own files live behind the account; the router gets them inline. */
const OWN_MEDIA = /^\/api\/media\//;
/** A result field that names a file to keep. */
const MEDIA_URL = /^https:\/\/\S+$/;
/**
 * Fields that name a copy we do not keep: a watermarked version, a cover or thumbnail of the result, Wan's separate
 * audio check track (the video carries the sound).
 */
const SKIP_KEY = /watermark|thumbnail|cover|poster|preview|check_audio/i;

/** A file in a result: a link to download, or the bytes themselves (base64: Veo, OpenAI's b64_json, Gemini's inlineData). */
type Found = { url: string } | { base64: string; contentType: string };

/** The image type of base64 bytes by their signature (OpenAI's b64_json names no type per image). */
function imageTypeOf(base64: string): string {
  const head = Buffer.from(base64.slice(0, 24), "base64");
  if (head[0] === 0x89 && head[1] === 0x50) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return "image/png";
}

/** Every file a result names, in document order, once each. Gemini's thought images (`thought: true`) are drafts. */
function mediaIn(value: unknown, found: Found[] = []): Found[] {
  if (typeof value === "string") {
    if (MEDIA_URL.test(value) && !found.some((f) => "url" in f && f.url === value)) found.push({ url: value });
  } else if (Array.isArray(value)) {
    for (const v of value) mediaIn(v, found);
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.thought === true) return found;
    const mimeType = typeof o.mimeType === "string" ? o.mimeType : undefined;
    let bytes: string | undefined;
    if (typeof o.bytesBase64Encoded === "string") {
      bytes = "bytesBase64Encoded";
      found.push({ base64: o.bytesBase64Encoded, contentType: mimeType ?? "application/octet-stream" });
    } else if (typeof o.b64_json === "string") {
      bytes = "b64_json";
      found.push({ base64: o.b64_json, contentType: imageTypeOf(o.b64_json) });
    } else if (typeof o.data === "string" && mimeType && /^(image|video|audio)\//.test(mimeType)) {
      // Gemini's inlineData: { mimeType, data }
      bytes = "data";
      found.push({ base64: o.data, contentType: mimeType });
    }
    for (const [k, v] of Object.entries(o)) if (k !== bytes && !SKIP_KEY.test(k)) mediaIn(v, found);
  }
  return found;
}

const errorTypeOf = (body: unknown) =>
  body && typeof body === "object" && typeof (body as { error_type?: unknown }).error_type === "string"
    ? (body as { error_type: string }).error_type
    : undefined;

export function createComfyProvider(opts: {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Base of Comfy's asset store (videos go there as signed links). */
  assetsUrl?: string;
  /** Loads one of our own media files so it can be sent inline. */
  loadMedia?: (url: string) => Promise<{ data: Uint8Array; contentType: string } | undefined>;
  timeouts?: Partial<ComfyTimeouts>;
}): Provider {
  const doFetch = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? COMFY_ROUTER).replace(/\/+$/, "");
  const limits = { ...TIMEOUTS, ...opts.timeouts };
  const auth = { Authorization: `Bearer ${opts.apiKey}` };
  const within = (ms: number, signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
  const route = (model: string) => {
    const [provider, name, ...rest] = model.split("/");
    if (!provider || !name || rest.length) return undefined;
    return `${base}/v2/models/${encodeURIComponent(provider)}/${encodeURIComponent(name)}/requests`;
  };

  async function load(url: string) {
    const file = await opts.loadMedia?.(url);
    if (!file) throw new Error(`media not found: ${url}`);
    return { mimeType: file.contentType, data: file.data, base64: Buffer.from(file.data).toString("base64") };
  }

  /** Puts one of our videos into Comfy's asset store and returns its signed link (the field order is the store's rule). */
  async function asset(url: string, file: { mimeType: string; data: Uint8Array }) {
    const form = new FormData();
    form.append("content_type", file.mimeType);
    form.append("file_path", url.split("/").pop() ?? "upload.mp4");
    form.append("expires_in", "86400");
    form.append("file", new Blob([new Uint8Array(file.data)], { type: file.mimeType }), url.split("/").pop() ?? "upload.mp4");
    const assetsUrl = (opts.assetsUrl ?? COMFY_ASSETS).replace(/\/+$/, "");
    let res: Response;
    try {
      res = await doFetch(`${assetsUrl}/api/v2/assets`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(limits.download) });
    } catch (e) {
      throw new AssetUploadFailed(`asset upload: ${describe(e)}`);
    }
    const body = (await res.json().catch(() => undefined)) as { url?: unknown } | undefined;
    if (!res.ok || typeof body?.url !== "string") throw new AssetUploadFailed(`asset upload HTTP ${res.status}`);
    return body.url;
  }

  /**
   * The params with each of our media URLs as a data URL (videos as a signed asset link), and each marker from
   * catalog.ts filled from the file: `{ $inlineBase64 }` → `{ bytesBase64Encoded, mimeType }` (Veo), `{ $rawBase64 }` →
   * the bare base64 string (FLUX.2, Kling), `{ $inlineData }` → `{ inlineData: { mimeType, data } }` (Gemini),
   * `{ $assetLink }` → a signed link from the asset store (Bria). Throws if a file cannot be loaded.
   */
  async function inline(value: unknown): Promise<unknown> {
    if (typeof value === "string" && OWN_MEDIA.test(value)) {
      const file = await load(value);
      return file.mimeType.startsWith("video/") ? asset(value, file) : `data:${file.mimeType};base64,${file.base64}`;
    }
    if (Array.isArray(value)) return Promise.all(value.map(inline));
    if (value && typeof value === "object") {
      const o = value as Record<string, unknown>;
      const [key, url] = Object.entries(o)[0] ?? [];
      if (Object.keys(o).length === 1 && key && key in MARKERS && typeof url === "string" && OWN_MEDIA.test(url)) {
        const file = await load(url);
        switch (MARKERS[key as keyof typeof MARKERS]) {
          case "veo": return { bytesBase64Encoded: file.base64, mimeType: file.mimeType };
          case "raw": return file.base64;
          case "gemini": return { inlineData: { mimeType: file.mimeType, data: file.base64 } };
          case "asset": return asset(url, file);
        }
      }
      return Object.fromEntries(await Promise.all(Object.entries(o).map(async ([k, v]) => [k, await inline(v)] as const)));
    }
    return value;
  }

  /** A read: anything transient throws and the worker asks again later. */
  async function read(url: string, ms: number, signal?: AbortSignal) {
    const res = await doFetch(url, { headers: auth, signal: within(ms, signal) });
    if (isBusy(res.status) || isAccount(res.status)) throw new Error(`Comfy Router ${res.status}`);
    return res;
  }

  /** Downloads a result file without our key: the file host signs its own links. */
  async function download(url: string, signal?: AbortSignal): Promise<ProviderOutput> {
    const res = await doFetch(url, { signal: within(limits.download, signal) });
    if (!res.ok) throw new Error(`download ${res.status}`);
    return { contentType: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim(), data: new Uint8Array(await res.arrayBuffer()) };
  }

  return {
    async submit(req, signal) {
      const url = route(req.providerModel);
      if (!url) return { state: "failed", reason: "invalid_request", detail: `not a router model id: ${req.providerModel}` };
      let input: unknown;
      try {
        input = await inline(req.params);
      } catch (e) {
        if (e instanceof AssetUploadFailed) throw e;
        return { state: "failed", reason: "invalid_request", detail: describe(e) };
      }
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST", body: JSON.stringify(input), headers: { ...auth, "Content-Type": "application/json" }, signal: within(limits.submit, signal),
        });
      } catch (e) {
        if (neverSent(e)) throw e;
        return { state: "failed", reason: isTimeout(e) ? "timeout" : "provider_error", detail: `submit without answer: ${describe(e)}` };
      }
      if (isBusy(res.status)) throw new Error(`Comfy Router ${res.status}`);
      const body = (await res.json().catch(() => undefined)) as { request_id?: unknown; error_type?: unknown } | undefined;
      if (!res.ok) {
        const type = errorTypeOf(body);
        return { state: "failed", reason: isAccount(res.status) ? "provider_error" : failure(type ?? "invalid_input"), detail: `HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 500)}` };
      }
      if (typeof body?.request_id !== "string" || !body.request_id) return { state: "failed", reason: "provider_error", detail: "queued without request_id" };
      return { state: "pending", handle: `${req.providerModel}:${body.request_id}` };
    },

    async poll(handle, signal): Promise<ProviderResult> {
      const cut = handle.lastIndexOf(":");
      const url = cut > 0 ? route(handle.slice(0, cut)) : undefined;
      const id = handle.slice(cut + 1);
      if (!url || !id) return { state: "failed", reason: "provider_error", detail: `bad handle ${handle}` };
      const requestUrl = `${url}/${encodeURIComponent(id)}`;

      const status = await read(`${requestUrl}/status`, limits.poll, signal);
      const s = (await status.json()) as { status?: string; error_type?: string };
      if (!status.ok) return { state: "failed", reason: failure(errorTypeOf(s) ?? "internal_error"), detail: `status HTTP ${status.status}` };
      // Only COMPLETED is final; a status this code does not know yet is still running.
      if (s.status !== "COMPLETED") return { state: "pending", handle };
      if (s.error_type) return { state: "failed", reason: failure(s.error_type), detail: JSON.stringify(s).slice(0, 500) };

      const result = await read(requestUrl, limits.poll, signal);
      const body = (await result.json()) as unknown;
      const type = errorTypeOf(body);
      if (type || !result.ok) return { state: "failed", reason: failure(type ?? "internal_error"), detail: JSON.stringify(body).slice(0, 500) };
      const outputs = await Promise.all(mediaIn(body).map((f) =>
        "url" in f ? download(f.url, signal) : Promise.resolve({ contentType: f.contentType, data: new Uint8Array(Buffer.from(f.base64, "base64")) })));
      return { state: "completed", outputs: outputs.filter((o) => /^(image|video|audio)\//.test(o.contentType)) };
    },
  };
}
