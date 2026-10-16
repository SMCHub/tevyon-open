import { McpServer, type CallToolResult, type ResourceLink } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { createCommunity } from "../core/community";
import type { CreditStatement } from "../core/credits";
import type { createJobs, JobView } from "../core/jobs";
import { publicParams, type JobTypeDef, type Register } from "../core/register";
import type { MarketingProposal } from "../core/marketing-agent";
import type { Recipe } from "../core/recipes";
import type { ConsentRequestResult } from "./person-consent";
import { collectTurn, parseDirectorInput, type ClientEvent, type DirectorInput, type DirectorKey, type DirectorStart, type ModelChoice } from "./director";

/**
 * Tachyon's MCP server: the same job API as the Studio, for agents.
 * One instance per request and account. Everything an agent receives is in Tachyon terms: job types, model names,
 * credits, our own error codes and signed links to our own media. Never a purchase route or vendor detail.
 */
/** A preset as agents see it: what it does, what the user brings, and what one run costs. */
export type McpPreset = {
  id: string;
  title: string;
  tagline: string;
  category: string;
  /** What the user's photo has to show (recipes.ts). */
  needs: Recipe["needs"];
  badge: string | null;
  /** What fits as the optional wish of this preset. */
  wishHint: string | null;
  /** Set when the preset speaks a line: then wish is required and is the exact spoken words. */
  line: { label: string; placeholder: string } | null;
  credits: number | null;
};

/** A Director turn as ask_director sees it: running (its events, and a way to stop it), or refused with a reply for the user. */
export type McpDirectorStart =
  | { ok: true; model: { name: string }; events: AsyncIterable<ClientEvent>; stop(reason?: "left" | "failed"): void }
  | { ok: false; error: string; reply: string; limit?: number; used?: number };

export type McpDeps = {
  register: Register;
  jobs: ReturnType<typeof createJobs>;
  balance(accountId: string): Promise<number>;
  /** The account's credit statement (summary and movements, newest first). */
  statement(accountId: string): Promise<CreditStatement>;
  /** Start images for image-to-video: a signed upload address (agents with a shell) and an import from a public URL. */
  uploads?: {
    uploadUrl(accountId: string): { url: string; expiresIn: number };
    importImage(accountId: string, url: string): Promise<{ ok: true; path: string; contentType: string; bytes: number } | { ok: false; error: string; message: string }>;
    /** One of the account's finished outputs as an upload (core/reuse.ts, the same as POST /api/uploads/from-job). */
    fromJob?(accountId: string, jobId: string, index: number): Promise<{ ok: true; url: string } | { ok: false; error: "not_found" | "not_an_image" }>;
  };
  /** A model's lifecycle as the public catalog shows it (active, deprecated with retiresAt/successor, paused). */
  lifecycle?(jobType: string): { status: string; retiresAt?: string; successor?: string } | null;
  /**
   * keyId: the API key or OAuth connection of the request, recorded on every job it starts.
   * dailyLimit: credits it may spend per 24 hours (null or missing = no limit).
   */
  account: { id: string; email?: string; keyId?: string; dailyLimit?: number | null };
  /** Turns a job output path (/api/media/…) into a link the agent can open without a login: signed and absolute. */
  link(url: string): string;
  /**
   * The prompt limit of a model's prompt skill (max_chars), published as maxLength in list_models. The skills themselves
   * stay on the server.
   */
  promptMax?(jobType: string): number | undefined;
  /**
   * Consent for jobs that show real people from pictures (a job type with consentImages): request opens one for these pictures
   * (server/person-consent.ts), url is the page where the user confirms, signed in to Tevyon.
   */
  consent?: { request(accountId: string, jobType: string, params: unknown): Promise<ConsentRequestResult>; url(id: string): string };
  /**
   * Webhooks for finished jobs (core/webhooks.ts): check says why an address is refused (null when it is fine), register
   * adds it for a started job, secret is the account's signing secret.
   */
  webhooks?: { check(url: string): string | null; register(jobId: string, accountId: string, url: string): Promise<void>; secret(accountId: string): string | undefined };
  /**
   * The Director (ask_director, list_director_models). start() checks the body like POST /api/director (the photo
   * must be the caller's upload) and starts a turn; overview() lists its models with what they cost this account.
   */
  director?: {
    /** key: the key or app of the request; paid messages count against its daily limit like jobs. */
    start(accountId: string, body: unknown, signal?: AbortSignal, key?: DirectorKey): Promise<McpDirectorStart>;
    overview(accountId: string, key?: DirectorKey): Promise<{ share: number; paying: boolean; models: ModelChoice[] }>;
    /** How long ask_director waits for a turn before it stops it as failed (default 240 s, below the route's maxDuration). */
    deadlineMs?: number;
  };
  /**
   * Presets (list_presets, run_preset), the same as GET /api/presets and POST /api/presets/{id}: public fields and the
   * price of one run, and the job a run is. A recipe prompt never reaches the agent.
   */
  /**
   * Marketing Agent (list_marketing_styles, run_marketing_style, continue_marketing_ugc), the same as GET/POST
   * /api/marketing and POST /api/marketing/ugc. Style prompts never reach the agent.
   */
  marketing?: {
    overview(): { categories: unknown[]; styles: Array<Record<string, unknown>>; templates: Array<Record<string, unknown>> };
    start(accountId: string, body: Record<string, unknown>, opts: Record<string, unknown>): Promise<
      | { ok: true; jobs: JobView[]; partial?: string; next?: { styleId: string; wish: string; duration: number; aspect: string; credits: number } }
      | { ok: false; error: string; credits?: number; limit?: number; used?: number; issues?: string[] }
    >;
    continueUgc(accountId: string, body: Record<string, unknown>, opts: Record<string, unknown>): Promise<
      { ok: true; job: JobView } | { ok: false; error: string; credits?: number; limit?: number; used?: number }
    >;
  };
  presets?: {
    list(): McpPreset[];
    /** Errors: unknown_recipe, image_required, line_required, unknown_job_type. */
    build(id: string, inputs: { image: string; wish?: string }):
      | { ok: true; jobType: string; params: Record<string, unknown>; recipe: { id: string; title: string; wish?: string } }
      | { ok: false; error: string };
  };
  /**
   * The community (set_visibility), the same as PUT/DELETE /api/publications/{jobId}: one of the account's finished
   * results public or private again. The profile it needs is set up by a person in the Studio.
   */
  community?: Pick<ReturnType<typeof createCommunity>, "publish" | "unpublish">;
  /** Server-side log for unexpected errors. Their text never reaches the agent. */
  log?(error: unknown): void;
  now?(): number;
  /** Pause between status checks while a tool waits for a job (default: jobs.waitFor). Tests run a worker pass here. */
  wait?(ms: number): Promise<void>;
};

/**
 * The Director for the MCP server: the same checks as POST /api/director (conversation ends with the user, known
 * model, a photo only from the caller's own uploads), then the turn. The service is created lazily, like the route's.
 * network: the caller's network for the free turns of accounts without a purchase (src/server/network-limits.ts).
 */
export function directorForMcp(
  service: () => Promise<{
    start(accountId: string, input: DirectorInput, signal?: AbortSignal, key?: DirectorKey, network?: string): Promise<DirectorStart>;
    overview(accountId: string, key?: DirectorKey): Promise<{ share: number; paying: boolean; models: ModelChoice[] }>;
  }>,
  network?: string,
): NonNullable<McpDeps["director"]> {
  return {
    async start(accountId, body, signal, key) {
      const parsed = parseDirectorInput(accountId, body);
      if (!parsed.ok) return parsed;
      return (await service()).start(accountId, parsed.input, signal, key, network);
    },
    overview: async (accountId, key) => (await service()).overview(accountId, key),
  };
}

export const MCP_SERVER_VERSION = "0.1.0";
const MAX_WAIT_SECONDS = 50;
/** ask_director stops a turn after this long (as failed: a paid message is refunded). The MCP route allows 300 s. */
const DIRECTOR_DEADLINE_MS = 240_000;
const POLL_MS = 1500;
const LINK_DAYS = 7;
const DAY_MS = 24 * 3600_000;

/** A Marketing Agent creative as MCP tools see it, ready for run_marketing_style. */
function creativeOut(p: MarketingProposal) {
  return {
    type: "marketing", style_id: p.styleId, title: p.title, category: p.category, kind: p.kind,
    ...(p.wish ? { wish: p.wish } : {}), aspect: p.aspect, ...(p.duration !== undefined ? { duration: p.duration } : {}),
    ...(p.caption ? { caption: p.caption } : {}), why: p.why, needs: p.needs, credits: p.credits, start: "run_marketing_style",
  };
}

const INSTRUCTIONS = `Tevyon creates images and videos with leading models (FLUX, MiniMax, LTX, Kling, Veo and more) in one account. Jobs are paid in credits.
- Start with list_models. Before generate, call get_price, tell the user what the job costs and pass those credits to generate as max_credits. Never start a job the user has not seen the price of. Credits are reserved when a job starts and refunded in full if it fails or is blocked.
- Every start carries its own idempotency_key: a new one per intended job, the same one only to retry that job, so nothing is started or charged twice.
- Send the user's idea as the prompt with prompt_mode "auto" (the default): Tevyon writes the prompt for the chosen model. Use "exact" only for a finished prompt of your own; params.prompt has the model's character limit (maxLength in list_models).
- For anything that costs more than a few credits, offer a cheap draft first (shorter, lower resolution or a lighter model), then the final with the same settings and based_on the draft's job id, which reuses the draft's written prompt.
- Text the user wants shown or spoken (headlines, labels, dialogue) stays word for word, in its original language.
- Real people: never put a real, identifiable person into sexual, defamatory or deceptive scenes, and minors never into sexualised or risky content. A photo of a person needs that person's consent. A job that puts people from photos into a new picture starts only after the user confirmed in Tevyon: request_consent gives the link, then generate with consent_id.
- Talk about models by their public names only. When the user publishes a realistic result of real people, places or events, remind them to label it as AI-generated.
- Images usually take under 30 seconds, videos take minutes. Pass wait_seconds to generate, or call get_job with wait_seconds until the status is succeeded or failed.
- Results are links valid for ${LINK_DAYS} days. Show or download them for the user. reuse_result turns one into an upload for the next job.
- When the user is unsure what to make, ask_director turns their wish into priced proposals. It never starts a job; the user chooses.
- For marketing (product shots, ads, posters, shop images, UGC, motion) ask_marketing_agent plans a priced campaign from a brief; run_marketing_style starts a creative.
- Results are private. Only when the user asks, set_visibility shares a finished one in the Tevyon community (or makes it private again).`;

/** What an agent reads when a job that shows real people cannot start yet (core/consent.ts). */
const CONSENT_TEXT: Record<string, string> = {
  consent_required: "This job shows real people. Call request_consent with the same job_type and params, send the user the confirm_url, and once they confirmed in Tevyon call generate again with consent_id.",
  consent_pending: "The user has not confirmed yet. Ask them to open the confirm_url from request_consent and confirm, then call generate again.",
  consent_declined: "The user declined. Do not start this job with these pictures.",
  consent_used: "This consent has started a job already; it works once. Call request_consent for a new one.",
  consent_expired: "This consent ran out. Call request_consent for a new one.",
  consent_invalid: "This consent_id does not belong to this model, these pictures or this account. Call request_consent with the same job_type and params.",
};

const FAILURE_TEXT: Record<string, string> = {
  content_moderated: "The model's safety filter blocked this request. All credits were refunded.",
  invalid_request: "The model rejected these settings. All credits were refunded.",
  generation_failed: "The generation failed. All credits were refunded.",
  timed_out: "The generation took too long and was stopped. All credits were refunded.",
};

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

/** What an agent reads when set_visibility cannot share a result. */
const VISIBILITY_TEXT: Record<string, string> = {
  profile_required: "The account has no community profile yet. A person sets it up in Tevyon Studio → Profile (name, handle, community rules); then this works.",
  not_found: "There is no job with this id in this account.",
  not_ready: "Only a succeeded job can be shared.",
  consent_required:
    "This result was made from the account's own upload. Pass consent: true only if the account holds the rights to it and every recognisable person agreed to it being public.",
  hidden: "Moderation took this result out of the community after reports. It stays private until a person has reviewed it.",
};
const kindSchema = z.enum(["image", "video"]);
const waitSchema = z.number().int().min(0).max(MAX_WAIT_SECONDS).default(0)
  .describe(`Seconds to wait for the job to finish (0 to ${MAX_WAIT_SECONDS}).`);
const paramsSchema = z.record(z.string(), z.unknown())
  .describe("Parameters by the model's schema from list_models; prompt is required.");

const active = (j: JobView) => j.status === "queued" || j.status === "running";

function ok(data: Record<string, unknown>, summary: string, links: ResourceLink[] = []): CallToolResult {
  return { content: [{ type: "text", text: `${summary}\n${JSON.stringify(data)}` }, ...links], structuredContent: data };
}

function toolError(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `${code}: ${message}` }] };
}

/** The same words for every tool whose spending hits the key's daily limit (jobs and paid Director messages). */
function keyLimitError(limit: number | string, used: number | string): CallToolResult {
  return toolError("key_limit_reached", `This key may spend ${limit} credits per 24 hours and ${used} are used. The owner can raise the limit in Tevyon Studio → "API & MCP".`);
}

/** Reports a wait: seconds waited of the whole wait, and the job's model and status. */
type Progress = (job: JobView, waited: number, total: number) => Promise<void>;

/**
 * MCP progress notifications while a tool waits for a job, when the client asked for them (a progressToken in the
 * request's _meta). Videos take minutes and a call waits at most 50 s; this way a client sees the job move instead of
 * polling get_job blindly. Progress only ever grows; a notification that fails never fails the tool.
 */
/**
 * A Marketing Agent template as list_marketing_styles sends it: id, base and title, plus only what differs from its
 * style. The full list repeated every field of the style for about a hundred templates (some 17,000 tokens per call);
 * style plus differences still give every field of the template (mcp.test.ts). Without its style it goes out whole.
 */
export function compactTemplate(t: Record<string, unknown>, style: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!style) return t;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  // A field the template leaves empty where its style has one goes out as null: JSON would drop undefined, and the
  // agent would take the style's value.
  return Object.fromEntries(
    Object.entries(t).filter(([k, v]) => k === "id" || k === "base" || k === "title" || !same(v, style[k])).map(([k, v]) => [k, v ?? null]),
  );
}

function progressFor(ctx: unknown): Progress | undefined {
  type Req = { _meta?: { progressToken?: string | number }; notify?: (n: { method: string; params: Record<string, unknown> }) => Promise<void> };
  const req = (ctx as { mcpReq?: Req } | undefined)?.mcpReq;
  const token = req?._meta?.progressToken;
  const notify = req?.notify;
  if (token === undefined || !notify) return undefined;
  let last = -1;
  return async (job, waited, total) => {
    const progress = Math.round(waited * 10) / 10;
    if (progress <= last) return;
    last = progress;
    await notify({ method: "notifications/progress", params: { progressToken: token, progress, total, message: `${job.model}: ${job.status}` } }).catch(() => {});
  };
}

export function createTachyonMcpServer(deps: McpDeps): McpServer {
  const { register, jobs, account, link, now = Date.now, log = (e) => console.error("[mcp]", e) } = deps;
  // Tests inject wait (one worker pass). The server wakes as soon as its own worker moves the job (jobs.waitFor) and
  // still reads the job again at least every POLL_MS, for jobs another instance advances.
  const pause = (jobId: string, ms: number) => (deps.wait ? deps.wait(ms) : jobs.waitFor(jobId, ms));

  const server = new McpServer({ name: "tevyon", title: "Tevyon", version: MCP_SERVER_VERSION }, { instructions: INSTRUCTIONS });

  /** Unexpected errors (database, network) become a neutral tool error; the detail goes to the server log only. */
  function safe<A extends unknown[]>(fn: (...args: A) => Promise<CallToolResult>) {
    return async (...args: A): Promise<CallToolResult> => {
      try {
        return await fn(...args);
      } catch (e) {
        log(e);
        return toolError("internal_error", "Something went wrong on Tevyon's side. Try again in a moment.");
      }
    };
  }

  function jobOut(v: JobView) {
    return {
      id: v.id,
      job_type: v.jobType,
      model: v.model,
      status: v.status,
      credits: v.credits,
      params: v.params,
      created_at: new Date(v.createdAt).toISOString(),
      outputs: v.outputs.map((o) => ({ url: link(o.url), content_type: o.contentType })),
      ...(v.error ? { error: { code: v.error, message: FAILURE_TEXT[v.error] ?? "The job failed. All credits were refunded." } } : {}),
    };
  }

  function jobResult(v: JobView, extra: Record<string, unknown> = {}): CallToolResult {
    const job = jobOut(v);
    const links: ResourceLink[] = job.outputs.map((o, i) => ({
      type: "resource_link",
      uri: o.url,
      name: `tevyon-${v.id.slice(0, 8)}-${i + 1}.${EXT[o.content_type] ?? "bin"}`,
      title: `${v.model} · ${i + 1}`,
      mimeType: o.content_type,
    }));
    const summary =
      v.status === "succeeded" ? `Job ${v.id} (${v.model}) is done: ${links.length} file(s), links valid for ${LINK_DAYS} days.`
      : v.status === "failed" ? `Job ${v.id} (${v.model}) failed. ${job.error?.message ?? ""}`
      : `Job ${v.id} (${v.model}) is ${v.status}, ${v.credits} credits reserved. Call get_job with job_id "${v.id}" and wait_seconds to get the result.`;
    return ok({ job, ...extra }, summary, links);
  }

  /** Waits until the job is done or the time is up. The worker advances jobs in the background. */
  async function settle(jobId: string, seconds: number, progress?: Progress): Promise<JobView | undefined> {
    const start = now();
    const deadline = start + seconds * 1000;
    let job = await jobs.get(account.id, jobId);
    while (job && active(job) && now() < deadline) {
      await pause(jobId, Math.min(POLL_MS, deadline - now()));
      job = await jobs.get(account.id, jobId);
      if (job && progress) await progress(job, (now() - start) / 1000, seconds);
    }
    return job;
  }

  function lifecycleOf(jobType: string) {
    const life = deps.lifecycle?.(jobType);
    if (!life) return {};
    return { status: life.status, ...(life.retiresAt ? { retires_at: life.retiresAt } : {}), ...(life.successor ? { successor: life.successor } : {}) };
  }

  /** Prices always come from the job API (live price book), never from a formula read here. */
  function priceFrom(def: JobTypeDef): number | null {
    const q = jobs.quote(def.jobType, { prompt: "x", ...def.sample });
    return q.ok ? q.credits : null;
  }

  /** Who started a job: the origin, and the key or app with its daily limit. */
  const startedBy = () => ({
    origin: "mcp" as const,
    ...(account.keyId ? { apiKeyId: account.keyId } : {}),
    ...(account.keyId && typeof account.dailyLimit === "number" ? { keyLimit: { credits: account.dailyLimit, windowMs: DAY_MS } } : {}),
  });

  /** Why a job did not start. `tool` is what the agent calls again. */
  async function startFailed(
    res: { error: string; credits?: number; limit?: number; used?: number; issues?: string[]; successor?: unknown },
    jobType: string,
    params: Record<string, unknown>,
    maxCredits: number | undefined,
    tool: string,
  ): Promise<CallToolResult> {
    if (res.error === "key_limit_reached") return keyLimitError(res.limit ?? account.dailyLimit ?? "its", res.used ?? "all");
    if (res.error === "price_changed") {
      return toolError("price_changed", `This job now costs ${res.credits ?? "more"} credits, not ${maxCredits}. Tell the user the new price and call ${tool} again with max_credits ${res.credits ?? "from the price"}.`);
    }
    if (res.error in CONSENT_TEXT) return toolError(res.error, CONSENT_TEXT[res.error]!);
    if (res.error !== "insufficient_credits") return quoteError(jobType, res);
    const q = jobs.quote(jobType, params);
    const balance = await deps.balance(account.id);
    return toolError("insufficient_credits", `This job costs ${q.ok ? q.credits : "more"} credits, the account has ${balance}. Credits can be topped up in Tevyon Studio.`);
  }

  function quoteError(jobType: string, q: { error: string; issues?: string[]; successor?: unknown }): CallToolResult {
    switch (q.error) {
      case "unknown_job_type":
        return toolError("unknown_job_type", `There is no job_type "${jobType}". Call list_models for the available models.`);
      case "invalid_params":
        return toolError("invalid_params", `${(q.issues ?? []).join("; ")}. The parameters of each model are in list_models.`);
      case "model_retired":
        return toolError("model_retired", `${jobType} is no longer available.${typeof q.successor === "string" ? ` Its successor is ${q.successor}.` : ""} Call list_models.`);
      case "model_paused":
        return toolError("model_paused", `${jobType} is paused for the moment. Try again later or pick another model from list_models.`);
      default:
        return toolError(q.error, "The job could not be started. Call list_models and get_price, then try again.");
    }
  }

  server.registerTool(
    "list_models",
    {
      title: "List models",
      description:
        "Lists Tevyon's image and video models: job_type, model name, what it is good at, its parameters as JSON Schema " +
        "(params.prompt with the model's character limit), the credits it costs with default settings (price_from) and its " +
        "lifecycle (status active, deprecated with retires_at and successor, or paused).",
      inputSchema: z.object({ kind: kindSchema.optional().describe("Only image or only video models.") }),
      annotations: readOnly,
    },
    safe(async ({ kind }) => {
      const models = register.list().filter((d) => !kind || d.kind === kind).map((d) => ({
        job_type: d.jobType,
        kind: d.kind,
        model: d.model,
        description: d.tagline,
        ...(d.badge ? { badge: d.badge } : {}),
        price_from: priceFrom(d),
        ...lifecycleOf(d.jobType),
        parameters: publicParams(d, deps.promptMax?.(d.jobType)),
      }));
      return ok({ models }, `${models.length} models. Call get_price before generate.`);
    }),
  );

  server.registerTool(
    "get_price",
    {
      title: "Get price",
      description:
        "What a job costs in credits before it starts, the account's balance and hints on the prompt (notes). " +
        "Free and starts nothing. Tell the user the price before you call generate.",
      inputSchema: z.object({ job_type: z.string().describe("From list_models."), params: paramsSchema }),
      annotations: readOnly,
    },
    safe(async ({ job_type, params }) => {
      const q = jobs.quote(job_type, params);
      if (!q.ok) return quoteError(job_type, q);
      const balance = await deps.balance(account.id);
      const model = register.get(job_type)?.model ?? job_type;
      return ok(
        { job_type, model, credits: q.credits, balance, enough: balance >= q.credits, notes: q.prompt.notes },
        `${model}: ${q.credits} credits. Balance ${balance}.`,
      );
    }),
  );

  server.registerTool(
    "generate",
    {
      title: "Generate image or video",
      description:
        "Starts a job and reserves its credits; they are refunded in full if the job fails or is blocked. Call get_price first. " +
        'prompt_mode "auto" (default) lets Tevyon write the prompt for the model from the user\'s idea; "exact" sends your own ' +
        "finished prompt unchanged (up to the model's maxLength in list_models). " +
        "Pass wait_seconds to wait for the result in this call, else poll get_job. " +
        "idempotency_key is required: a new unique string (e.g. a UUID) per intended job, the same one only to retry it, " +
        "so that a retried call never starts or charges a job twice. Pass max_credits (the credits from get_price) " +
        "so the job only starts at the price you showed the user.",
      inputSchema: z.object({
        job_type: z.string().describe("From list_models."),
        params: paramsSchema,
        prompt_mode: z.enum(["auto", "exact"]).default("auto"),
        wait_seconds: waitSchema,
        idempotency_key: z.string().min(1).max(200).describe("A new unique string per intended job, e.g. a UUID. Reuse it only to retry that job."),
        max_credits: z.number().int().min(0).optional().describe("The credits from get_price. The job does not start if it now costs more."),
        based_on: z.uuid().optional().describe("Id of a draft job (or the first format of a set) whose written prompt this job reuses, so the final keeps the draft's look."),
        consent_id: z.uuid().optional().describe("Jobs that show real people from photos: the consent_id from request_consent, after the user confirmed in Tevyon."),
        webhook_url: z.string().optional().describe(
          "An https address that gets the finished job as a POST (job.finished, signed with webhook_secret from get_account), instead of polling get_job.",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ job_type, params, prompt_mode, wait_seconds, idempotency_key, max_credits, based_on, consent_id, webhook_url }, ctx) => {
      // A webhook address is checked before anything starts: https, public, and webhooks available at all.
      if (webhook_url !== undefined) {
        const refused = deps.webhooks ? deps.webhooks.check(webhook_url) : "webhooks are not available";
        if (refused) return toolError("invalid_params", `webhook_url: ${refused}. Use a public https address, or poll get_job.`);
      }
      const res = await jobs.start(account.id, job_type, params, {
        promptMode: prompt_mode,
        idempotencyKey: idempotency_key,
        ...startedBy(),
        // The price the agent showed the user holds: if it rose since get_price, nothing starts and nothing is reserved.
        ...(max_credits !== undefined ? { maxCredits: max_credits } : {}),
        ...(based_on ? { basedOn: based_on } : {}),
        ...(consent_id ? { consentId: consent_id } : {}),
      });
      if (!res.ok) return startFailed(res, job_type, params, max_credits, "generate");
      if (webhook_url !== undefined) await deps.webhooks!.register(res.job.id, account.id, webhook_url);
      const job = wait_seconds > 0 ? ((await settle(res.job.id, wait_seconds, progressFor(ctx))) ?? res.job) : res.job;
      const result = jobResult(job, { balance: await deps.balance(account.id), ...(webhook_url !== undefined ? { webhook_url } : {}) });
      if (webhook_url !== undefined && (job.status === "queued" || job.status === "running")) {
        const first = result.content[0];
        if (first?.type === "text") first.text += " The webhook gets the result when it is done.";
      }
      return result;
    }),
  );

  server.registerTool(
    "get_job",
    {
      title: "Get job",
      description:
        "Status and results of a job. With wait_seconds it waits until the job is done or the time is up; " +
        "call it again while the status is queued or running.",
      inputSchema: z.object({ job_id: z.uuid().describe("From generate or list_jobs."), wait_seconds: waitSchema }),
      annotations: readOnly,
    },
    safe(async ({ job_id, wait_seconds }, ctx) => {
      const job = await settle(job_id, wait_seconds, progressFor(ctx));
      if (!job) return toolError("not_found", "There is no job with this id in this account.");
      return jobResult(job);
    }),
  );

  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description: "The account's jobs, newest first, with their status and result links.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(10),
        kind: kindSchema.optional(),
        status: z.enum(["queued", "running", "succeeded", "failed"]).optional(),
      }),
      annotations: readOnly,
    },
    safe(async ({ limit, kind, status }) => {
      const list = (await jobs.list(account.id))
        .filter((j) => (!kind || register.get(j.jobType)?.kind === kind) && (!status || j.status === status))
        .slice(0, limit)
        .map(jobOut);
      return ok({ jobs: list }, `${list.length} job(s), newest first.`);
    }),
  );

  server.registerTool(
    "get_account",
    {
      title: "Get account",
      description: "The signed-in Tevyon account, its credit balance and the secret that signs its webhooks (x-tevyon-signature).",
      annotations: readOnly,
    },
    safe(async () => {
      const credits = await deps.balance(account.id);
      const secret = deps.webhooks?.secret(account.id);
      return ok({ email: account.email ?? null, credits, ...(secret ? { webhook_secret: secret } : {}) }, `${credits} credits available.`);
    }),
  );

  server.registerTool(
    "get_credits",
    {
      title: "Get credit statement",
      description:
        "The account's credit statement: available, reserved (held by running jobs), spent, refunded, granted and expired credits, " +
        "the latest movements, newest first (job, model, state reserved/charged/refunded, price, balance after), and the plan " +
        "credits still running (expiring: credits and until when; they are spent first and lapse at the end of their month).",
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(20).describe("How many of the latest movements.") }),
      annotations: readOnly,
    },
    safe(async ({ limit }) => {
      const { summary, entries, expiring } = await deps.statement(account.id);
      const latest = entries.slice(0, limit).map((e) => ({ ...e, at: new Date(e.at).toISOString() }));
      const until = expiring ? new Date(expiring.at).toISOString() : null;
      return ok(
        { summary, entries: latest, expiring: expiring ? { credits: expiring.credits, until } : null },
        `${summary.available} credits available, ${summary.reserved} reserved by running jobs, ${summary.spent} spent.` +
          (expiring ? ` ${expiring.credits} of them are plan credits that run until ${until!.slice(0, 10)}.` : ""),
      );
    }),
  );

  if (deps.community) {
    const community = deps.community;
    server.registerTool(
      "set_visibility",
      {
        title: "Share in the community",
        description:
          "Makes one of the account's finished results public in the Tevyon community, or private again (the default). Only on the " +
          "user's request. Needs a community profile, which a person sets up in Tevyon Studio. show_prompt: whether others see the " +
          "prompt (default: the profile's choice). consent: needed once for a result made from an own upload (photo, video); pass " +
          "true only if the account holds the rights and every recognisable person agreed to it being public.",
        inputSchema: z.object({
          job_id: z.uuid().describe("A succeeded job of this account (generate, list_jobs)."),
          visibility: z.enum(["public", "private"]),
          show_prompt: z.boolean().optional(),
          consent: z.boolean().optional(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      safe(async ({ job_id, visibility, show_prompt, consent }) => {
        if (visibility === "private") {
          const res = await community.unpublish(account.id, job_id);
          if (!res.ok) return toolError("not_found", VISIBILITY_TEXT.not_found!);
          return ok({ job_id, visibility: "private" }, "The result is private again.");
        }
        const res = await community.publish(account.id, job_id, { ...(show_prompt === undefined ? {} : { showPrompt: show_prompt }), consent: consent === true });
        if (!res.ok) return toolError(res.error, VISIBILITY_TEXT[res.error] ?? "The result could not be shared.");
        return ok({ job_id, visibility: "public", show_prompt: res.publication.showPrompt }, "The result is public in the Tevyon community.");
      }),
    );
  }

  if (deps.uploads) {
    const uploads = deps.uploads;
    server.registerTool(
      "create_upload",
      {
        title: "Create upload address",
        description:
          "A signed address to upload one image (PNG, JPEG or WebP, up to 10 MB) or one reference video (MP4 or MOV, " +
          "4 to 30 seconds, up to 50 MB) into the account, valid for 15 minutes. Use it from a shell: the answer of the PUT " +
          "is JSON with url; always take that url (a video's url carries its length, e.g. …_12s.mp4). Pass an image as " +
          "params.image (start image) or in params.references, a video as params.video of recast. For an image on the web use import_image instead.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      safe(async () => {
        const { url, expiresIn } = uploads.uploadUrl(account.id);
        const curl = `curl -X PUT --data-binary @/path/to/image.png '${url}'`;
        return ok(
          { upload_url: url, method: "PUT", expires_in_seconds: expiresIn, curl },
          `Upload the image with: ${curl}. The answer contains url; pass it as params.image to generate.`,
        );
      }),
    );

    server.registerTool(
      "import_image",
      {
        title: "Import image from the web",
        description:
          "Copies a public image (https, PNG, JPEG or WebP, up to 10 MB) into the account's uploads and returns its path. " +
          "Pass that path as params.image to generate (start image for image-to-video). Private and internal addresses are refused.",
        inputSchema: z.object({ url: z.string().url().describe("A public https address of the image.") }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      safe(async ({ url }) => {
        const res = await uploads.importImage(account.id, url);
        if (!res.ok) return toolError(res.error, `The image could not be imported: ${res.message}.`);
        return ok({ image: res.path, content_type: res.contentType, bytes: res.bytes }, `Imported. Use "${res.path}" as params.image.`);
      }),
    );

    if (uploads.fromJob) {
      const fromJob = uploads.fromJob;
      server.registerTool(
        "reuse_result",
        {
          title: "Reuse a result",
          description:
            "Turns one of your finished images or videos into an upload, so it can go into another job: an image in " +
            "params.references or as params.image (start image), a video as params.video of recast. The same result twice gives the same path.",
          inputSchema: z.object({
            job_id: z.uuid().describe("A finished job of this account (from generate or list_jobs)."),
            index: z.number().int().min(0).default(0).describe("Which output of the job; 0 is the first."),
          }),
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        safe(async ({ job_id, index }) => {
          const res = await fromJob(account.id, job_id, index);
          if (!res.ok) {
            return toolError(res.error, res.error === "not_found"
              ? "There is no finished result with this job id and index in the account. Call list_jobs."
              : "This output is neither an image nor a readable video.");
          }
          return ok({ upload: res.url }, `Use "${res.url}" in params.references, as params.image or as params.video of recast.`);
        }),
      );
    }
  }

  if (deps.consent) {
    const consent = deps.consent;
    server.registerTool(
      "request_consent",
      {
        title: "Request the user's consent",
        description:
          "Some jobs show real people from photos. Before they start, the user confirms in Tevyon (signed in) that they " +
          "hold the rights to the pictures and the consent of everyone shown. Pass the same job_type and params as for generate; " +
          "send the user confirm_url, then call generate with consent_id. A consent works once, for exactly these pictures, for two hours.",
        inputSchema: z.object({ job_type: z.string().describe("A job type from list_models."), params: paramsSchema }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      safe(async ({ job_type, params }) => {
        const res = await consent.request(account.id, job_type, params);
        if (!res.ok) {
          if (res.error === "not_needed") return toolError("not_needed", `${job_type} needs no confirmation. Call generate.`);
          return quoteError(job_type, res);
        }
        const url = consent.url(res.id);
        return ok(
          { consent_id: res.id, confirm_url: url, expires_at: new Date(res.expiresAt).toISOString() },
          `Send the user this link to confirm in Tevyon: ${url}. Once they confirmed, call generate with consent_id "${res.id}" and the same params (confirm_url works for two hours).`,
        );
      }),
    );
  }

  if (deps.presets) {
    const presets = deps.presets;

    server.registerTool(
      "list_presets",
      {
        title: "List presets",
        description:
          "Tevyon's presets: one click and one photo of the user give a finished clip. Tevyon fixes model, format, " +
          "length, sound and prompt; the user may add a short wish (wishHint shows what fits). A preset with line speaks the " +
          "user's words in the clip: ask the user for them and pass them as wish. needs: photo (a person), product (or a dish) " +
          "or place (a room). Each preset with the credits of one run. Start one with run_preset.",
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      safe(async () => {
        const list = presets.list();
        return ok({ presets: list }, `${list.length} presets. Tell the user the price before you call run_preset with max_credits.`);
      }),
    );

    server.registerTool(
      "run_preset",
      {
        title: "Run a preset",
        description:
          "Starts a preset on the user's photo and reserves its credits; they are refunded in full if the job fails or is blocked. " +
          "The photo must be the user's own upload (create_upload or import_image). If people are shown in it, ask the user first " +
          "whether everyone shown agreed to appear in the clip; pass consent true only then (it is always required). Pass max_credits (the credits from list_presets " +
          "or ask_director) so the job only starts at the price you showed. idempotency_key is required: a new unique string per " +
          "intended run, the same one only to retry it. Pass wait_seconds or poll get_job; clips take minutes.",
        inputSchema: z.object({
          preset_id: z.string().describe("From list_presets or a preset proposal of ask_director."),
          image: z.string().describe("The user's photo: the path from create_upload or import_image (/api/media/uploads/…)."),
          wish: z.string().max(200).optional().describe(
            "A short extra wish in the user's words, e.g. “with a red cape”. Required for a preset with line: the exact words spoken in the clip (up to 120 characters).",
          ),
          consent: z.boolean().describe("true only if the user confirmed that everyone shown in the photo agreed to appear in the clip (or nobody is shown)."),
          max_credits: z.number().int().min(0).optional().describe("The credits from list_presets. The job does not start if it now costs more."),
          idempotency_key: z.string().min(1).max(200).describe("A new unique string per intended run, e.g. a UUID. Reuse it only to retry that run."),
          wait_seconds: waitSchema,
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      safe(async ({ preset_id, image, wish, consent, max_credits, idempotency_key, wait_seconds }, ctx) => {
        // Real people only with their consent.
        if (!consent) {
          return toolError("consent_required", "If people are shown in the photo, ask the user whether everyone shown agreed to appear in the clip. Then call run_preset with consent true.");
        }
        // Only the caller's own uploads can be the photo.
        if (!image.startsWith(`/api/media/uploads/${account.id}/`)) {
          return toolError("invalid_params", "image must be the user's own upload: the path from create_upload or import_image.");
        }
        const tidy = wish?.trim().replace(/\s+/g, " ").slice(0, 200);
        const built = presets.build(preset_id, { image, ...(tidy ? { wish: tidy } : {}) });
        if (!built.ok) {
          if (built.error === "unknown_recipe") return toolError("unknown_preset", `There is no preset "${preset_id}". Call list_presets for the available presets.`);
          if (built.error === "image_required") return toolError("image_required", "This preset needs the user's photo as image.");
          if (built.error === "line_required") return toolError("line_required", "This preset speaks a line in the clip. Ask the user for the exact words and pass them as wish.");
          return toolError("unknown_preset", `The preset "${preset_id}" cannot run on this server. Pick another one from list_presets.`);
        }
        // Recipe prompts are written for their model: the prompt skill only tidies up (promptMode exact, no extra LLM call).
        // The job carries its preset, so every view shows the preset and never the recipe prompt.
        const res = await jobs.start(account.id, built.jobType, built.params, {
          promptMode: "exact",
          idempotencyKey: idempotency_key,
          recipe: built.recipe,
          ...startedBy(),
          ...(max_credits !== undefined ? { maxCredits: max_credits } : {}),
        });
        if (!res.ok) return startFailed(res, built.jobType, built.params, max_credits, "run_preset");
        const job = wait_seconds > 0 ? ((await settle(res.job.id, wait_seconds, progressFor(ctx))) ?? res.job) : res.job;
        return jobResult(job, { balance: await deps.balance(account.id) });
      }),
    );
  }

  if (deps.marketing) {
    const marketing = deps.marketing;
    const MS_TEXT: Record<string, string> = {
      unknown_style: "There is no such style. Call list_marketing_styles.",
      style_unavailable: "This style is not available at the moment. Pick another one from list_marketing_styles.",
      product_image_required: "This style needs the product photo as product (the user's upload).",
      avatar_required: "UGC needs a photo of the person as avatar (the user's upload).",
      avatar_not_supported: "This style takes no avatar. Leave avatar out.",
      ad_reference_not_supported: "This style takes no ad_reference. Leave it out.",
      poster_content_required: "A poster needs the product photo or a description in wish.",
      line_required: "UGC speaks a line: ask the user for the exact words and pass them as wish.",
      aspect_ratio_invalid: "This format is not offered for the style; use one of its aspects from list_marketing_styles.",
      duration_invalid: "This length is not offered for the style; see its duration in list_marketing_styles.",
      batch_size_invalid: "count must be 1 to 4, and 1 for styles without batch.",
      consent_required: "An avatar shows a real person: ask the user whether that person agreed, then pass consent true.",
      invalid_params: "Files must be the user's own uploads (create_upload or import_image).",
      not_found: "That still is not a UGC still of this style in this account.",
      frame_not_ready: "The still is not done yet. Wait with get_job, then call continue_marketing_ugc again.",
      insufficient_credits: "The account has too few credits. Credits can be topped up in Tevyon Studio.",
      model_paused: "The model of this style is paused for the moment. Try again later.",
      model_retired: "This style cannot run any more. Pick another one.",
    };
    const refuse = (r: { error: string; credits?: number; limit?: number; used?: number }, tool: string): CallToolResult => {
      if (r.error === "key_limit_reached") return keyLimitError(r.limit ?? account.dailyLimit ?? "its", r.used ?? "all");
      if (r.error === "price_changed") return toolError("price_changed", `This now costs ${r.credits ?? "more"} credits. Tell the user the new price and call ${tool} again with max_credits ${r.credits ?? "from the price"}.`);
      return toolError(r.error, MS_TEXT[r.error] ?? "Could not start. Call list_marketing_styles and try again.");
    };

    server.registerTool(
      "list_marketing_styles",
      {
        title: "List Marketing Agent styles",
        description:
          "Tevyon's Marketing Agent turns a product photo into ready-to-post content in six categories: ugc (a person holds the product " +
          "and talks about it, video), product (product shots, with or without a model), motion (animated product clip), ads, posters and " +
          "marketplace (shop images). Each style lists what it needs (product, avatar, ad_reference), its formats (aspects), length (duration), " +
          "whether count 1–4 works (batch), and the credits of one run at its defaults. templates are concrete scenes of a style " +
          "(base) with their own look, run with the same rules as their style; a template lists only what differs from its style " +
          "(title, cover, look), every other field and the price are its style's. Start a style or a template by its id with run_marketing_style.",
        inputSchema: z.object({ category: z.enum(["ugc", "product", "motion", "ads", "posters", "marketplace"]).optional() }),
        annotations: readOnly,
      },
      safe(async ({ category }) => {
        const o = marketing.overview();
        const styles = o.styles.filter((s) => s.available && (!category || s.category === category));
        const byId = new Map(o.styles.map((s) => [String(s.id), s]));
        const templates = o.templates
          .filter((t) => t.available && (!category || t.category === category))
          .map((t) => compactTemplate(t, byId.get(String(t.base))));
        return ok(
          { categories: o.categories, styles, templates },
          `${styles.length} styles, ${templates.length} templates. Tell the user the price before you call run_marketing_style with max_credits.`,
        );
      }),
    );

    server.registerTool(
      "run_marketing_style",
      {
        title: "Run a Marketing Agent style",
        description:
          "Starts a Marketing Agent style on the user's product photo and reserves its credits (refunded in full if it fails). Files must be " +
          "the user's own uploads (create_upload or import_image). An avatar is a real person: ask whether they agreed and pass consent true. " +
          "Pass max_credits (the price you showed, per run) and a new idempotency_key per intended run. count 1–4 starts separate jobs for " +
          "styles with batch. UGC runs in two steps: this call makes the still (the person holding the product) and returns next; when that " +
          "job has succeeded, call continue_marketing_ugc with its job id, which makes the talking video (already included in the price).",
        inputSchema: z.object({
          style_id: z.string().describe("From list_marketing_styles."),
          product: z.string().optional().describe("Path of the product photo (/api/media/uploads/…)."),
          avatar: z.string().optional().describe("Path of a photo of the person (styles with avatar)."),
          ad_reference: z.string().optional().describe("Path of an ad whose layout and look to follow (styles with adReference)."),
          wish: z.string().max(200).optional().describe("Scene wish, the lettering for text styles, a description for posters without photo, or the spoken words for UGC."),
          aspect: z.string().optional().describe("One of the style's aspects."),
          duration: z.number().int().optional().describe("Seconds, for video styles within the style's duration."),
          count: z.number().int().min(1).max(4).optional(),
          consent: z.boolean().optional().describe("true only if the person in avatar agreed."),
          max_credits: z.number().int().min(0).optional().describe("The credits of one run you showed. Nothing starts if it now costs more."),
          idempotency_key: z.string().min(1).max(200),
          wait_seconds: waitSchema,
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      safe(async ({ style_id, product, avatar, ad_reference, wish, aspect, duration, count, consent, max_credits, idempotency_key, wait_seconds }, ctx) => {
        const res = await marketing.start(account.id, {
          styleId: style_id, product, avatar, adReference: ad_reference, wish, aspect, duration, count, consent,
        }, { idempotencyKey: idempotency_key, ...startedBy(), ...(max_credits !== undefined ? { maxCredits: max_credits } : {}) });
        if (!res.ok) return refuse(res, "run_marketing_style");
        const first = res.jobs[0]!;
        const job = wait_seconds > 0 && res.jobs.length === 1 ? ((await settle(first.id, wait_seconds, progressFor(ctx))) ?? first) : first;
        const extra = {
          ...(res.jobs.length > 1 ? { job_ids: res.jobs.map((j) => j.id) } : {}),
          ...(res.partial ? { partial: res.partial } : {}),
          ...(res.next ? { next: { tool: "continue_marketing_ugc", frame_job_id: first.id, style_id: res.next.styleId, wish: res.next.wish, duration: res.next.duration, aspect: res.next.aspect, max_credits: res.next.credits } } : {}),
          balance: await deps.balance(account.id),
        };
        return jobResult(job, extra);
      }),
    );

    server.registerTool(
      "continue_marketing_ugc",
      {
        title: "UGC step 2: make the still talk",
        description:
          "Second step of a UGC style: once the still from run_marketing_style has succeeded, this turns it into the talking video. Pass the " +
          "values from that call's next. Idempotent per still: calling it again returns the same video job, never a second charge.",
        inputSchema: z.object({
          frame_job_id: z.string(),
          style_id: z.string(),
          wish: z.string().max(200).describe("The spoken words (as in step 1)."),
          duration: z.number().int().optional(),
          aspect: z.string().optional(),
          max_credits: z.number().int().min(0).optional(),
          wait_seconds: waitSchema,
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      safe(async ({ frame_job_id, style_id, wish, duration, aspect, max_credits, wait_seconds }, ctx) => {
        const res = await marketing.continueUgc(account.id, { frameJobId: frame_job_id, styleId: style_id, wish, duration, aspect }, {
          ...startedBy(), ...(max_credits !== undefined ? { maxCredits: max_credits } : {}),
        });
        if (!res.ok) return refuse(res, "continue_marketing_ugc");
        const job = wait_seconds > 0 ? ((await settle(res.job.id, wait_seconds, progressFor(ctx))) ?? res.job) : res.job;
        return jobResult(job, { balance: await deps.balance(account.id) });
      }),
    );
  }

  if (deps.director) {
    const director = deps.director;
    /** Paid Director messages count against the key's daily limit like jobs (the Director checks it). */
    const key = account.keyId ? { id: account.keyId, dailyLimit: account.dailyLimit ?? null } : undefined;

    server.registerTool(
      "ask_director",
      {
        title: "Ask the Director",
        description:
          "Tevyon's Director is a creative planner: it turns the user's wish into 2–3 concrete, priced proposals, either a " +
          "custom generation (model, prompt and settings) or a one-click preset. It never starts a job. Show its reply (written in " +
          "the user's language) and the proposals with their credits. Start a custom proposal with generate (its job_type and " +
          'params, max_credits = credits) only after the user chose it; proposals with start "run_preset" are presets: start them ' +
          "with run_preset (the user's photo and their consent needed). suggestions (if any) are short replies the user might send " +
          "next: offer them, never send one on your own. Continue a conversation by passing the earlier messages as history. The default model plans " +
          "for free within a daily budget; the strongest models (list_director_models) cost credits per message, so never retry " +
          "a call on your own.",
        inputSchema: z.object({
          message: z.string().min(1).max(2000).describe("The user's wish in their own words, e.g. “a viral clip of my dog as a superhero, for TikTok”."),
          history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(20).optional()
            .describe("Earlier messages of this conversation with the Director, oldest first (its replies as assistant)."),
          model: z.string().optional().describe("A model id from list_director_models. Default: the free standard model."),
          photo: z.string().optional()
            .describe("Path of the user's photo from create_upload or import_image (/api/media/uploads/…), for proposals built on it."),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      safe(async ({ message, history, model, photo }, ctx) => {
        const body = { history: [...(history ?? []), { role: "user", content: message }], ...(model ? { model } : {}), ...(photo ? { photo } : {}) };
        const started = await director.start(account.id, body, ctx.mcpReq.signal, key);
        if (!started.ok) {
          if (started.error === "key_limit_reached") return keyLimitError(started.limit ?? account.dailyLimit ?? "its", started.used ?? "all");
          return toolError(started.error, started.reply);
        }

        // Past the deadline the turn stops as failed: a paid message goes back in full, nothing hangs past maxDuration.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), director.deadlineMs ?? DIRECTOR_DEADLINE_MS)));
        const collecting = collectTurn(started.events);
        collecting.catch(() => {}); // after a timeout its outcome no longer matters
        const turn = await Promise.race([collecting, late]).finally(() => clearTimeout(timer));
        if (turn === "late") {
          started.stop("failed");
          return toolError("director_timeout", "The Director took too long and was stopped. Nothing was charged for this message. Try again in a moment.");
        }
        if (turn.error) return toolError("director_unavailable", "The Director could not finish its answer. A paid message is refunded. Try again in a moment.");

        const proposals = turn.proposals.map((p) =>
          p.type === "custom"
            ? { type: "custom", job_type: p.jobType, kind: p.kind, model: p.model, prompt: p.prompt, params: p.params, why: p.why, credits: p.credits, start: "generate" }
            : p.type === "preset"
              ? { type: "preset", preset_id: p.presetId, title: p.title, why: p.why, ...(p.wish ? { wish: p.wish } : {}), credits: p.credits, start: deps.presets ? "run_preset" : "studio" }
              : creativeOut(p),
        );
        const cost = turn.charged !== undefined
          ? ` This message cost ${turn.charged} credits.`
          : turn.budget ? ` Free Director turns left today with this model: ${turn.budget.turnsLeft}.` : "";
        return ok(
          {
            reply: turn.reply,
            model: started.model.name,
            proposals,
            ...(turn.suggestions.length ? { suggestions: turn.suggestions } : {}),
            ...(turn.charged !== undefined ? { charged: turn.charged } : {}),
            ...(turn.budget ? { budget: { allowed: turn.budget.allowed, turns_left: turn.budget.turnsLeft, share_left: turn.budget.share } } : {}),
          },
          `The Director (${started.model.name}) answered with ${proposals.length} proposal(s). Show the reply and the prices to the user.` +
            `${turn.suggestions.length ? " Offer its suggestions as the user's possible next messages." : ""}${cost}`,
        );
      }),
    );

    server.registerTool(
      "list_director_models",
      {
        title: "List Director models",
        description:
          "The language models the Director can plan with, and what each costs this account today: free turns left from the " +
          "daily budget, or credits per message (typical and at most) for the strongest models, which unlock with the first purchase. " +
          'locked "key_limit": a message could exceed this key\'s daily limit.',
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      safe(async () => {
        const o = await director.overview(account.id, key);
        const models = o.models.map((m) => ({
          id: m.id, name: m.name, maker: m.maker, tier: m.tier, default: m.default, paid: m.paid,
          ...(m.credits ? { credits: m.credits } : {}),
          allowed: m.allowed,
          ...(m.turnsLeft !== undefined ? { turns_left: m.turnsLeft } : {}),
          ...(m.locked ? { locked: m.locked } : {}),
        }));
        const usable = models.filter((m) => m.allowed).length;
        return ok({ share_left: o.share, paying: o.paying, models }, `${usable} of ${models.length} Director models are available to this account today.`);
      }),
    );

    if (deps.marketing) {
      server.registerTool(
        "ask_marketing_agent",
        {
          title: "Ask the Marketing Agent",
          description:
            "Tevyon's Marketing Agent plans a small campaign: from the user's brief (product, goal, channels, audience, offer) it proposes up " +
            "to four ready-to-post creatives, each a Marketing Agent style or template with its lettering or spoken line, format, length, a " +
            "post caption and the credits of one run. It never starts a job. Show its reply (in the user's language) and the creatives with their credits; " +
            "start a chosen one with run_marketing_style (style_id, wish, aspect, duration, the product photo, max_credits = credits). " +
            "`needs` lists inputs still missing (product photo). Pass the product photo as photo so it plans for that product. It shares " +
            "the Director's daily budget and models (list_director_models).",
          inputSchema: z.object({
            message: z.string().min(1).max(2000).describe("The brief in the user's words, e.g. “launch of my organic lemonade on Instagram, young urban audience”."),
            history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(20).optional()
              .describe("Earlier messages of this conversation with the agent, oldest first."),
            model: z.string().optional().describe("A model id from list_director_models. Default: the free standard model."),
            photo: z.string().optional().describe("The product photo from create_upload or import_image (/api/media/uploads/…)."),
            has_avatar: z.boolean().optional().describe("True if the user has a photo of a person for UGC and people styles."),
            product_name: z.string().max(120).optional(),
            product_description: z.string().max(400).optional(),
          }),
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        },
        safe(async ({ message, history, model, photo, has_avatar, product_name, product_description }, ctx) => {
          const body = {
            history: [...(history ?? []), { role: "user", content: message }], agent: "marketing", hasAvatar: has_avatar === true,
            ...(model ? { model } : {}), ...(photo ? { photo } : {}),
            ...(product_name || product_description ? { product: { name: product_name, description: product_description } } : {}),
          };
          const started = await director.start(account.id, body, ctx.mcpReq.signal, key);
          if (!started.ok) {
            if (started.error === "key_limit_reached") return keyLimitError(started.limit ?? account.dailyLimit ?? "its", started.used ?? "all");
            return toolError(started.error, started.reply);
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), director.deadlineMs ?? DIRECTOR_DEADLINE_MS)));
          const collecting = collectTurn(started.events);
          collecting.catch(() => {});
          const turn = await Promise.race([collecting, late]).finally(() => clearTimeout(timer));
          if (turn === "late") {
            started.stop("failed");
            return toolError("director_timeout", "The Marketing Agent took too long and was stopped. Nothing was charged for this message. Try again in a moment.");
          }
          if (turn.error) return toolError("director_unavailable", "The Marketing Agent could not finish its answer. A paid message is refunded. Try again in a moment.");
          const creatives = turn.proposals.flatMap((p) => (p.type === "marketing" ? [creativeOut(p)] : []));
          const cost = turn.charged !== undefined
            ? ` This message cost ${turn.charged} credits.`
            : turn.budget ? ` Free turns left today with this model: ${turn.budget.turnsLeft}.` : "";
          return ok(
            {
              reply: turn.reply, model: started.model.name, creatives,
              ...(turn.charged !== undefined ? { charged: turn.charged } : {}),
              ...(turn.budget ? { budget: { allowed: turn.budget.allowed, turns_left: turn.budget.turnsLeft, share_left: turn.budget.share } } : {}),
            },
            `The Marketing Agent (${started.model.name}) planned ${creatives.length} creative(s). Show the reply, the captions and the prices to the user.${cost}`,
          );
        }),
      );
    }
  }

  return server;
}
