/**
 * Client for Tevyon's public HTTP API. The CLI knows nothing else about the platform:
 * models come from /api/catalog, starting prices from /api/prices and the price of a job from /api/quote, so a new
 * or retired model needs no CLI release.
 */
export type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

export type Model = {
  jobType: string;
  kind: "image" | "video";
  model: string;
  tagline: string;
  badge: string | null;
  params: JsonSchema;
  status?: string;
  successor?: string | null;
};

export type PriceEntry = { jobType: string; from: number; standard: number };

export type PromptNote = { code: string; level: "info" | "warn"; message: string };
export type Quote = { ok: true; credits: number; prompt?: { skill: string; notes: PromptNote[] } };

export type Job = {
  id: string;
  jobType: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed";
  credits: number;
  outputs: { url: string; contentType: string }[];
  error?: string;
  params: Record<string, unknown>;
  promptSkill?: string;
  createdAt: number;
};

export type Me = { email: string | null; credits: number; demo?: boolean };

export type DeviceStart = { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval: number };
const CLI_CLIENT_ID = "tachyon-cli";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export type CreditEntry = {
  id: string;
  at: number;
  credits: number;
  balance: number;
  /** grant, job, director (a paid Director message), reversal (refund, dispute), expiry (plan credits that lapsed). */
  kind: "grant" | "job" | "director" | "reversal" | "expiry";
  source?: string;
  model?: string;
  state?: "reserved" | "charged" | "refunded";
  amount?: number;
  origin?: string;
};
export type CreditStatement = {
  summary: { available: number; reserved: number; spent: number; refunded: number; granted: number };
  entries: CreditEntry[];
  /** Plan credits still running and when the first of them ends. */
  expiring?: { credits: number; at: number } | null;
};


export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown> | null;
  constructor(status: number, code: string, body: Record<string, unknown> | null) {
    super(code);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createApi(deps: { base: string; key?: string; fetch: FetchFn }) {
  const { base, key } = deps;

  async function send(method: string, path: string, opts: { body?: unknown; raw?: { data: Uint8Array; contentType: string }; form?: Record<string, string>; headers?: Record<string, string>; auth?: boolean } = {}) {
    // x-tachyon-client lets the server record that a job came from the CLI (statement, key overview).
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "tevyon-cli/0.1.0", "x-tachyon-client": "cli", ...opts.headers };
    if (opts.auth !== false && key) headers.authorization = `Bearer ${key}`;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.raw) headers["content-type"] = opts.raw.contentType;
    if (opts.form) headers["content-type"] = "application/x-www-form-urlencoded";
    const body = opts.raw ? opts.raw.data : opts.form ? new URLSearchParams(opts.form).toString() : opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    let res: Response;
    try {
      res = await deps.fetch(new URL(path, base), { method, headers, ...(body !== undefined ? { body: body as BodyInit } : {}) });
    } catch {
      throw new ApiError(0, "network", null);
    }
    return res;
  }

  async function json<T>(method: string, path: string, opts: Parameters<typeof send>[2] = {}): Promise<T> {
    const res = await send(method, path, opts);
    const data = (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null;
    if (!res.ok || (data && data.ok === false)) {
      throw new ApiError(res.status, typeof data?.error === "string" ? data.error : `http_${res.status}`, data);
    }
    return data as T;
  }

  return {
    base,
    async catalog(): Promise<Model[]> {
      return (await json<{ jobTypes: Model[] }>("GET", "/api/catalog", { auth: false })).jobTypes;
    },
    /** The public price list: per job type the cheapest settings (from) and the default settings (standard), in credits. */
    async prices(): Promise<PriceEntry[]> {
      return (await json<{ prices: PriceEntry[] }>("GET", "/api/prices", { auth: false })).prices;
    },
    quote(jobType: string, params: Record<string, unknown>): Promise<Quote> {
      return json<Quote>("POST", "/api/quote", { body: { jobType, params }, auth: false });
    },
    me(): Promise<Me> {
      return json<Me>("GET", "/api/me");
    },
    /** maxCredits: the price the user saw. If the job costs more by now, the server starts nothing (price_changed). */
    /** basedOn: a draft job whose written prompt the final reuses (draft → final). */
    /** consentId: for Face Swap and Character Swap, a consent the person confirmed in Tevyon (requestConsent). */
    async start(jobType: string, params: Record<string, unknown>, opts: { idempotencyKey: string; promptMode: "auto" | "exact"; maxCredits: number; basedOn?: string; consentId?: string }): Promise<Job> {
      const res = await json<{ job: Job }>("POST", `/api/jobs/${encodeURIComponent(jobType)}`, {
        body: {
          params, promptMode: opts.promptMode, maxCredits: opts.maxCredits,
          ...(opts.basedOn ? { basedOn: opts.basedOn } : {}), ...(opts.consentId ? { consentId: opts.consentId } : {}),
        },
        headers: { "idempotency-key": opts.idempotencyKey },
      });
      return res.job;
    },
    /** A consent request for a job that shows real people: the person opens `url`, signed in, and confirms. */
    requestConsent(jobType: string, params: Record<string, unknown>): Promise<{ id: string; url: string; expiresAt: string }> {
      return json("POST", "/api/consent", { body: { jobType, params } });
    },
    /** The state of a consent request: pending, confirmed, declined, used or expired. */
    consent(id: string): Promise<{ state: string }> {
      return json("GET", `/api/consent/${encodeURIComponent(id)}`);
    },
    async jobs(ids?: string[]): Promise<Job[]> {
      const query = ids ? `?ids=${ids.map(encodeURIComponent).join(",")}` : "";
      return (await json<{ jobs: Job[] }>("GET", `/api/jobs${query}`)).jobs;
    },
    /** Starts the browser login (RFC 8628): a code the user confirms in Tevyon Studio. name labels the CLI's key. */
    async deviceAuthorize(name: string): Promise<DeviceStart> {
      const res = await send("POST", "/oauth/device_authorization", { form: { client_id: CLI_CLIENT_ID, scope: "tachyon", name }, auth: false });
      const data = (await res.json().catch(() => null)) as (DeviceStart & { error?: string }) | null;
      if (!res.ok || !data?.device_code) throw new ApiError(res.status, data?.error ?? `http_${res.status}`, data);
      return data;
    },
    /** One poll: the API key once the user confirmed, else the OAuth error (authorization_pending, slow_down …). */
    async deviceToken(deviceCode: string): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
      const res = await send("POST", "/oauth/token", { form: { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: CLI_CLIENT_ID }, auth: false });
      const data = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
      return res.ok && data?.access_token ? { ok: true, key: data.access_token } : { ok: false, error: data?.error ?? `http_${res.status}` };
    },
    /** Puts an image into the account's uploads. Returns its Tevyon path, the value for --image. */
    async upload(data: Uint8Array, contentType: string): Promise<string> {
      return (await json<{ url: string }>("POST", "/api/uploads", { raw: { data, contentType } })).url;
    },
    async download(url: string): Promise<{ data: Uint8Array; contentType: string }> {
      const res = await send("GET", url);
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`, null);
      return { data: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    },
    credits(limit?: number): Promise<CreditStatement> {
      return json<CreditStatement>("GET", `/api/credits${limit ? `?limit=${limit}` : ""}`);
    },
    /** The statement as the server's CSV (semicolons, BOM), unchanged. */
    async creditsCsv(): Promise<string> {
      const res = await send("GET", "/api/credits?format=csv");
      if (!res.ok) throw new ApiError(res.status, res.status === 401 ? "unauthorized" : `http_${res.status}`, null);
      // ignoreBOM keeps the byte order mark that Excel needs for umlauts; res.text() would drop it.
      return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
    },
  };
}

export type Api = ReturnType<typeof createApi>;
