import type { Job, Model } from "../src/api.ts";

/**
 * An in-memory Tachyon with the same HTTP contract as the platform (/api/catalog, /api/prices, /api/quote, /api/me,
 * POST /api/jobs/{type}, GET /api/jobs[?ids], /api/media). Every status poll moves a job one step on.
 */
export const KEY = `tch_${"A".repeat(40)}`;
export const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
export const ACCOUNT = "6b51eb70-153d-4141-8a09-0c1bc73be9e5";

export const MODELS: Model[] = [
  {
    jobType: "test_image", kind: "image", model: "Test Image 2", tagline: "Test maker · stills", badge: "top",
    params: {
      type: "object",
      properties: { prompt: { type: "string" }, aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16"], default: "1:1" } },
      required: ["prompt"],
    },
  },
  {
    jobType: "test_video", kind: "video", model: "Test Video 3", tagline: "Test maker · clips with sound", badge: null,
    params: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        duration: { anyOf: [{ type: "number", const: 4 }, { type: "number", const: 8 }], default: 8 },
        generate_audio: { type: "boolean", default: true },
        image: { type: "string", pattern: "^\\/api\\/media\\/uploads\\/[0-9a-f-]{36}\\/[A-Za-z0-9_-]+\\.(png|jpe?g|webp)$" },
      },
      required: ["prompt"],
    },
  },
  {
    jobType: "test_swap", kind: "image", model: "Test Swap", tagline: "Test maker · face swap", badge: null,
    params: {
      type: "object",
      properties: {
        prompt: { type: "string", default: "" },
        image: { type: "string", pattern: "^\\/api\\/media\\/uploads\\/[0-9a-f-]{36}\\/[A-Za-z0-9_-]+\\.(png|jpe?g|webp)$" },
        face: { type: "string", pattern: "^\\/api\\/media\\/uploads\\/[0-9a-f-]{36}\\/[A-Za-z0-9_-]+\\.(png|jpe?g|webp)$" },
        consent: { type: "boolean", const: true },
      },
      required: ["image", "face", "consent"],
    },
  },
];

type Outcome = "succeed" | "fail" | "never";

type DeviceOutcome = "approve" | "deny" | "expire" | "throttled";

export function fakeTachyon(opts: {
  credits?: number; outcome?: Outcome; outputs?: number; device?: DeviceOutcome; keyLimit?: { limit: number; used: number };
  /** More statement lines (plan grants, expiries, reversals …) and the plan credits still running. */
  statement?: { entries?: Record<string, unknown>[]; expiring?: { credits: number; at: number } | null };
  /** Job types the catalog lists as running out (status deprecated, with a successor). */
  deprecated?: string[];
  /** What the person does on the consent page: confirm (default) or decline. */
  consent?: "confirm" | "decline";
} = {}) {
  let credits = opts.credits ?? 100;
  const jobs = new Map<string, Job & { polls: number }>();
  const byKey = new Map<string, string>();
  const requests: { method: string; path: string; headers: Headers; body: any }[] = [];
  const uploads: Uint8Array[] = [];
  /** Device login: first poll pending, second slow_down, third the outcome. */
  let devicePolls = 0;
  let failNetworkOnce = false;
  /** The one consent request of a run (swaps over the API need a person's confirmation). */
  let consent = { id: "", state: "none", polls: 0 };
  let n = 0;

  function price(jobType: string, params: Record<string, unknown>): number | { error: string; issues?: string[] } {
    const model = MODELS.find((m) => m.jobType === jobType);
    if (!model) return { error: "unknown_job_type" };
    const allowed = Object.keys(model.params.properties ?? {});
    const bad = Object.keys(params).filter((k) => !allowed.includes(k));
    // The swap's wish is optional, every other model needs a prompt.
    const needsPrompt = (model.params.required ?? []).includes("prompt");
    if (bad.length || typeof params.prompt !== "string" || (needsPrompt && !params.prompt)) return { error: "invalid_params", issues: [`${bad[0] ?? "prompt"}: invalid`] };
    if (jobType === "test_image") return 4;
    if (jobType === "test_swap") return 15;
    const seconds = typeof params.duration === "number" ? params.duration : 8;
    return (params.generate_audio === false ? 3 : 4) * seconds;
  }

  const view = (j: Job & { polls: number }): Job => {
    const { polls: _polls, ...rest } = j;
    return rest;
  };

  function advance(j: Job & { polls: number }) {
    if (j.status !== "queued" && j.status !== "running") return;
    j.polls++;
    const outcome = opts.outcome ?? "succeed";
    if (j.polls === 1 || outcome === "never") j.status = "running";
    else if (outcome === "fail") {
      j.status = "failed";
      j.error = "content_moderated";
      credits += j.credits;
    } else {
      j.status = "succeeded";
      const ext = j.jobType === "test_video" ? "mp4" : "png";
      j.outputs = Array.from({ length: opts.outputs ?? 1 }, (_, i) => ({ url: `/api/media/${j.id}/${i}.${ext}`, contentType: ext === "mp4" ? "video/mp4" : "image/png" }));
    }
  }

  const json = (data: unknown, status = 200) => Response.json(data, { status });

  async function fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const isJson = (headers.get("content-type") ?? "").includes("json");
    const body = init.body && isJson ? JSON.parse(String(init.body)) : init.body;
    requests.push({ method, path: url.pathname + url.search, headers, body });
    if (failNetworkOnce && method === "POST" && url.pathname.startsWith("/api/jobs/")) {
      failNetworkOnce = false;
      // The server got the job, but the answer never arrived: the retry must not start a second one.
      await handle();
      throw new TypeError("fetch failed");
    }
    return handle();

    async function handle(): Promise<Response> {
      const authed = headers.get("authorization") === `Bearer ${KEY}`;
      const p = url.pathname;
      if (p === "/oauth/device_authorization") {
        const form = new URLSearchParams(String(body ?? ""));
        if (form.get("client_id") !== "tachyon-cli") return json({ error: "invalid_client" }, 401);
        if (opts.device === "throttled") return json({ error: "too_many_requests", error_description: "Too many requests. Try again in 540 seconds.", retry_after: 540 }, 429);
        return json({
          device_code: `tcd_${"D".repeat(40)}`, user_code: "WDJB-MJHT", verification_uri: `${url.origin}/device`,
          verification_uri_complete: `${url.origin}/device?code=WDJB-MJHT`, expires_in: 600, interval: 5, name: form.get("name"),
        });
      }
      if (p === "/oauth/token") {
        const form = new URLSearchParams(String(body ?? ""));
        if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code" || form.get("device_code") !== `tcd_${"D".repeat(40)}`) {
          return json({ error: "invalid_grant" }, 400);
        }
        devicePolls++;
        if (devicePolls === 1) return json({ error: "authorization_pending" }, 400);
        if (devicePolls === 2) return json({ error: "slow_down" }, 400);
        const outcome = opts.device ?? "approve";
        if (outcome === "deny") return json({ error: "access_denied" }, 400);
        if (outcome === "expire") return json({ error: "expired_token" }, 400);
        return json({ access_token: KEY, token_type: "Bearer", scope: "tachyon" });
      }
      if (p === "/api/catalog") {
        return json({ jobTypes: MODELS.map((m) => (opts.deprecated?.includes(m.jobType) ? { ...m, status: "deprecated", successor: "test_image" } : { ...m, status: "active" })) });
      }
      // The public price list: per model the cheapest settings (from) and the defaults (standard), as the platform's.
      if (p === "/api/prices") {
        return json({ prices: [
          { jobType: "test_image", model: "Test Image 2", kind: "image", from: 4, standard: 4, settings: { aspect_ratio: "1:1" } },
          { jobType: "test_video", model: "Test Video 3", kind: "video", from: 12, standard: 32, settings: { duration: 8, generate_audio: true } },
        ] });
      }
      if (p === "/api/quote") {
        const res = price(body.jobType, body.params);
        if (typeof res !== "number") return json({ ok: false, ...res }, 400);
        const notes = body.params.prompt === "x" ? [] : [{ code: "camera_missing", level: "info", message: "Keine Kamera angegeben." }];
        return json({ ok: true, credits: res, prompt: { skill: "prompt-test@1.0.0", notes: body.jobType === "test_video" ? notes : [] } });
      }
      if (!authed) return json({ ok: false, error: "unauthorized" }, 401);
      if (p === "/api/consent" && method === "POST") {
        consent = { id: "c0000000-aaaa-4bbb-8ccc-000000000001", state: "pending", polls: 0 };
        return json({ ok: true, id: consent.id, url: `${url.origin}/consent/${consent.id}`, expiresAt: "2026-10-15T22:00:00.000Z" }, 201);
      }
      if (p.startsWith("/api/consent/") && method === "GET") {
        // The person confirms in the browser between the first and the second poll.
        if (++consent.polls >= 2 && opts.consent !== "decline") consent.state = "confirmed";
        if (consent.polls >= 2 && opts.consent === "decline") consent.state = "declined";
        return json({ ok: true, id: consent.id, state: consent.state });
      }
      if (p === "/api/me") return json({ email: "user@example.com", credits, demo: false });
      if (p.startsWith("/api/jobs/") && method === "POST") {
        const jobType = decodeURIComponent(p.slice("/api/jobs/".length));
        const key = headers.get("idempotency-key");
        const existing = key ? jobs.get(byKey.get(key) ?? "") : undefined;
        if (existing) return json({ ok: true, job: view(existing) }, 202);
        const res = price(jobType, body.params);
        if (typeof res !== "number") return json({ ok: false, ...res }, res.error === "unknown_job_type" ? 404 : 400);
        // A swap shows real people: over the API only with a consent the person confirmed in Tevyon.
        if (jobType === "test_swap" && body.consentId !== consent.id) return json({ ok: false, error: "consent_required" }, 403);
        if (jobType === "test_swap" && consent.state !== "confirmed") return json({ ok: false, error: "consent_pending" }, 409);
        if (typeof body.maxCredits === "number" && res > body.maxCredits) return json({ ok: false, error: "price_changed", credits: res }, 409);
        if (credits < res) return json({ ok: false, error: "insufficient_credits" }, 402);
        if (opts.keyLimit) return json({ ok: false, error: "key_limit_reached", ...opts.keyLimit }, 429);
        credits -= res;
        const id = `0000000${++n}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`;
        const job = { id, jobType, model: MODELS.find((m) => m.jobType === jobType)!.model, status: "queued" as const, credits: res, outputs: [], params: body.params, createdAt: Date.UTC(2026, 9, 13, 14, n), polls: 0 };
        jobs.set(id, job);
        if (key) byKey.set(key, id);
        return json({ ok: true, job: view(job) }, 202);
      }
      if (p === "/api/jobs") {
        const ids = url.searchParams.get("ids");
        if (ids === null) return json({ jobs: [...jobs.values()].reverse().map(view) });
        const found = ids.split(",").map((id) => jobs.get(id)).filter((j) => j !== undefined);
        for (const j of found) advance(j);
        return json({ jobs: found.map(view) });
      }
      if (p === "/api/uploads" && method === "POST") {
        const bytes = body as Uint8Array;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return json({ ok: false, error: "not_an_image" }, 415);
        uploads.push(bytes);
        return json({ ok: true, url: `/api/media/uploads/${ACCOUNT}/upload-${uploads.length}.png` }, 201);
      }
      if (p === "/api/credits") {
        if (url.searchParams.get("format") === "csv") {
          return new Response("\uFEFFDatum;Art;Beschreibung;Kanal;Status;Preis;Credits;Saldo\n", { headers: { "content-type": "text/csv; charset=utf-8" } });
        }
        const list = [...jobs.values()].reverse();
        const reserved = list.filter((j) => j.status === "queued" || j.status === "running").reduce((a, j) => a + j.credits, 0);
        const spent = list.filter((j) => j.status === "succeeded").reduce((a, j) => a + j.credits, 0);
        const entries = [
          ...list.map((j) => ({
            id: `job:${j.id}`, at: j.createdAt, credits: j.status === "failed" ? 0 : -j.credits, balance: credits,
            kind: "job", jobId: j.id, jobType: j.jobType, model: j.model,
            state: j.status === "failed" ? "refunded" : j.status === "succeeded" ? "charged" : "reserved", amount: j.credits, origin: "cli",
          })),
          ...(opts.statement?.entries ?? []),
          { id: "grant:1", at: Date.UTC(2026, 9, 12, 9), credits: 100, balance: 100, kind: "grant", source: "welcome" },
        ];
        const limit = Number(url.searchParams.get("limit"));
        return json({
          summary: { available: credits, reserved, spent, refunded: 0, granted: 100 },
          entries: Number.isInteger(limit) && limit > 0 ? entries.slice(0, limit) : entries,
          expiring: opts.statement?.expiring ?? null,
        });
      }
      if (p.startsWith("/api/media/")) {
        const job = jobs.get(p.split("/")[3] ?? "");
        return job ? new Response(PNG, { headers: { "content-type": "image/png" } }) : new Response("Not found", { status: 404 });
      }
      return json({ ok: false, error: "not_found" }, 404);
    }
  }

  return {
    fetch,
    requests,
    jobs,
    uploads,
    get credits() {
      return credits;
    },
    failNextStartNetwork() {
      failNetworkOnce = true;
    },
    started: () => requests.filter((r) => r.method === "POST" && r.path.startsWith("/api/jobs/")),
  };
}
