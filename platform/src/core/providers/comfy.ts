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

/** Our own files live behind the account; the router gets them inline. */
const OWN_MEDIA = /^\/api\/media\//;
/** A result field that names a file to keep. */
const MEDIA_URL = /^https:\/\/\S+$/;
/** Fields that name a copy we do not keep: a watermarked version, a cover or thumbnail of the result. */
const SKIP_KEY = /watermark|thumbnail|cover|poster|preview/i;

/** A file in a result: a link to download, or the bytes themselves (base64, e.g. Veo). */
type Found = { url: string } | { base64: string; contentType: string };

/** Every file a result names, in document order, once each. */
function mediaIn(value: unknown, found: Found[] = []): Found[] {
  if (typeof value === "string") {
    if (MEDIA_URL.test(value) && !found.some((f) => "url" in f && f.url === value)) found.push({ url: value });
  } else if (Array.isArray(value)) {
    for (const v of value) mediaIn(v, found);
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.bytesBase64Encoded === "string") {
      found.push({ base64: o.bytesBase64Encoded, contentType: typeof o.mimeType === "string" ? o.mimeType : "application/octet-stream" });
    }
    for (const [k, v] of Object.entries(o)) if (k !== "bytesBase64Encoded" && !SKIP_KEY.test(k)) mediaIn(v, found);
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
    return { mimeType: file.contentType, base64: Buffer.from(file.data).toString("base64") };
  }

  /**
   * The params with each of our media URLs as a data URL, and each `{ $inlineBase64: url }` marker (catalog.ts
   * inlineBase64) as `{ bytesBase64Encoded, mimeType }`. Throws if a file cannot be loaded.
   */
  async function inline(value: unknown): Promise<unknown> {
    if (typeof value === "string" && OWN_MEDIA.test(value)) {
      const file = await load(value);
      return `data:${file.mimeType};base64,${file.base64}`;
    }
    if (Array.isArray(value)) return Promise.all(value.map(inline));
    const marker = (value as { $inlineBase64?: unknown } | null)?.$inlineBase64;
    if (typeof marker === "string" && OWN_MEDIA.test(marker)) {
      const file = await load(marker);
      return { bytesBase64Encoded: file.base64, mimeType: file.mimeType };
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await inline(v)] as const)));
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
