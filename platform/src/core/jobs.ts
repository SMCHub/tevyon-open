import type { Availability } from "./availability";
import type { MediaStore } from "./media";
import { unattachedMentions, type PromptCheck, type PromptMode, type PromptPlan, type Prompting } from "./prompting";
import type { Provider, ProviderFailure, ProviderResult } from "./provider";
import type { JobTypeDef, Register } from "./register";
import type { Consent, ConsentCheck } from "./consent";
import type { JobFailure, JobOrigin, JobRecord, JobRepository, JobStatus } from "./repository";

export type { JobFailure, JobStatus } from "./repository";

export type JobError =
  | "unknown_job_type" | "invalid_params" | "insufficient_credits" | "price_changed" | "model_paused" | "model_retired" | "key_limit_reached"
  | Extract<ConsentCheck, { ok: false }>["error"];
export type Quote = { ok: true; credits: number; prompt: PromptCheck } | { ok: false; error: JobError; issues?: string[]; successor?: string };

/** Job ids are UUIDs; anything else is no job (and must not reach a uuid column). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An upload of ours: /api/media/uploads/<account>/<name>.<png|jpg|jpeg|webp>, or a reference video <name>_<seconds>s.mp4.
 * No other file is accepted as input.
 */
const UPLOAD = /^\/api\/media\/uploads\/([0-9a-f-]{36})\/(?:[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)|[A-Za-z0-9-]+_\d{1,3}s\.mp4)$/;
const FILE_PARAMS = new Set(["image", "references", "video"]);

/**
 * The first parameter that names a file the account does not own, if any. Input files (start image …) must be the
 * caller's own uploads, whichever channel starts the job (Studio, MCP, CLI), because the worker reads them from our store.
 */
function foreignInput(accountId: string, params: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(params)) {
    if (key === "prompt") continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === undefined || v === null) continue;
      const isFile = FILE_PARAMS.has(key) || (typeof v === "string" && v.startsWith("/api/media/"));
      if (isFile && (typeof v !== "string" || UPLOAD.exec(v)?.[1] !== accountId)) return key;
    }
  }
  return undefined;
}

const FAILURE: Record<ProviderFailure, JobFailure> = {
  moderated: "content_moderated",
  invalid_request: "invalid_request",
  provider_error: "generation_failed",
  timeout: "timed_out",
};

/** Public view of a job. Contains only Tachyon terms, never provider details. */
/** Preset marker on a job's stored params: which preset ran and the user's wish. Never sent to the vendor. */
export type RecipeTag = { id: string; title: string; wish?: string; inputs?: Record<string, unknown> };

function withoutRecipe(params: Record<string, unknown>): Record<string, unknown> {
  if (!("recipe" in params)) return params;
  const { recipe: _recipe, ...rest } = params;
  return rest;
}

/** What the vendor gets: the job type's own mapping (recipe prompt, our-only fields dropped), else the params as they are. */
function toVendor(def: JobTypeDef, params: Record<string, unknown>): Record<string, unknown> {
  return def.vendorParams ? def.vendorParams(params) : params;
}

/** What callers see of the params: a preset job shows its preset, never the recipe prompt. */
function publicParams(params: Record<string, unknown>): Record<string, unknown> {
  if (!("recipe" in params)) return params;
  const { prompt: _prompt, ...rest } = params;
  return rest;
}

export type JobView = {
  id: string;
  jobType: string;
  model: string;
  status: JobStatus;
  credits: number;
  outputs: { url: string; contentType: string }[];
  error?: JobFailure;
  /** The validated user parameters (prompt, duration …). The prompt is the user's own text, never the written one. */
  params: Record<string, unknown>;
  /** name@version of the prompt skill that prepared the job. */
  promptSkill?: string;
  createdAt: number;
};

/** Worker limits. Calls to start jobs (long for images) and status checks (short) have separate limits. */
export type WorkerOptions = {
  /** Jobs being started at the vendor at the same time, across all accounts. */
  submits?: number;
  /** Of those, at most this many per account, so one busy account cannot hold up everyone else. */
  perAccount?: number;
  /** Status checks of running jobs at the same time. */
  polls?: number;
  /**
   * The worker's own limit for one call, a safety net over the provider's limits. A start call cut off here is final
   * (timed_out, refunded), because it may have reached the vendor; a status check is simply asked again later.
   */
  submitTimeoutMs?: number;
  pollTimeoutMs?: number;
  /** First pause after a failed call; it doubles with every failure in a row, up to retryMaxMs. */
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** A job still active this long after it started fails as timed_out and gets its credits back: none hangs forever. */
  imageDeadlineMs?: number;
  videoDeadlineMs?: number;
  /**
   * How long a claim on a job lasts (repository claim). The worker renews it while a vendor call runs; when a worker
   * stops, another one takes its jobs over after this long.
   */
  leaseMs?: number;
  /** This worker's name in claims; one per process. */
  id?: string;
};

export function createJobs(deps: {
  register: Register;
  repo: JobRepository;
  providers: Record<string, Provider>;
  media: MediaStore;
  /** Every job runs through the prompt skill of its model. */
  prompting: Prompting;
  newId?: () => string;
  now?: () => number;
  /** Server-side operator log. Receives raw provider details that must never reach a JobView. */
  log?: (event: { jobId: string; error: JobFailure; detail?: string }) => void;
  /** Provider calls that may throw in a row before the job fails and is refunded. */
  maxUnreachable?: number;
  /** Lifecycle from the model sync. Paused and retired models take no new jobs; running jobs always finish. */
  availability?: (jobType: string) => Availability;
  /** How the worker paces itself; the defaults suit production. */
  worker?: WorkerOptions;
  /** Operator warnings from the worker (a store that is down, a call over its limit). Server-only, may name the vendor. */
  warn?: (message: string) => void;
  /** Called when a job was created, so the server hands it to the worker at once instead of on its next timer pass. */
  onQueued?: (jobId: string) => void;
  /** Confirmed consents for jobs that show real people (consentImages), when an agent starts them. */
  consent?: Pick<Consent, "check" | "use" | "release">;
  /** Marks a result as AI-made before it is stored (core/ai-label.ts, AI Act Art. 50); never re-encodes it. */
  label?: (data: Uint8Array, contentType: string) => Uint8Array;
  /** A start turned away before a job existed, for the operator overview (core/operations.ts). Must not throw. */
  refused?: (r: { jobType: string; origin: JobOrigin; error: string }) => void;
}) {
  const { register, repo, providers, media, prompting, newId = () => crypto.randomUUID(), now = Date.now, maxUnreachable = 5, log, availability } = deps;
  const warn = deps.warn ?? (() => {});

  function prepare(jobType: string, input: unknown) {
    const def = register.get(jobType);
    if (!def) return { ok: false as const, error: "unknown_job_type" as const };
    const available = availability?.(jobType);
    if (available && !available.ok && available.reason !== "unknown") {
      const error = available.reason === "retired" ? ("model_retired" as const) : ("model_paused" as const);
      return { ok: false as const, error, ...(available.successor ? { successor: available.successor } : {}) };
    }
    const parsed = def.params.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return { ok: false as const, error: "invalid_params" as const, issues };
    }
    return { ok: true as const, def, params: parsed.data as Record<string, unknown>, credits: def.credits(parsed.data) };
  }

  function view(r: JobRecord): JobView {
    const v: JobView = {
      id: r.id, jobType: r.jobType, model: r.model, status: r.status, credits: r.credits,
      outputs: r.outputs, params: publicParams(r.params), createdAt: r.createdAt,
    };
    if (r.error) v.error = r.error;
    if (r.promptSkill) v.promptSkill = r.promptSkill;
    return v;
  }

  /**
   * Identical starts of one account that arrive at the same time share one prompt-writer call: the Studio's “Count 4”
   * sends the same request four times at once, and four calls would cost four times. Nothing is kept afterwards, so a
   * later start (a “Variation”, a final after a blocked draft) always gets a freshly written prompt.
   */
  const compiling = new Map<string, Promise<PromptPlan>>();
  function compileOnce(accountId: string, jobType: string, params: Record<string, unknown>, mode: PromptMode): Promise<PromptPlan> {
    const key = JSON.stringify([accountId, jobType, mode, params]);
    const running = compiling.get(key);
    if (running) return running;
    const plan = prompting.compile(jobType, params, mode).finally(() => compiling.delete(key));
    compiling.set(key, plan);
    return plan;
  }

  function quote(jobType: string, input: unknown): Quote {
    const p = prepare(jobType, input);
    return p.ok ? { ok: true, credits: p.credits, prompt: prompting.check(jobType, p.params) } : p;
  }

  /** Every start turned away is counted for the operator overview; a name nobody offers goes into one bucket. */
  async function start(accountId: string, jobType: string, input: unknown, opts: Parameters<typeof startJob>[3] = {}) {
    const res = await startJob(accountId, jobType, input, opts);
    if (!res.ok) deps.refused?.({ jobType: register.get(jobType) ? jobType : "(unknown)", origin: opts.origin ?? "web", error: res.error });
    return res;
  }

  async function startJob(
    accountId: string, jobType: string, input: unknown,
    opts: {
      idempotencyKey?: string;
      promptMode?: PromptMode;
      /** Draft job whose written prompt the final reuses. */
      basedOn?: string;
      /** The price the caller showed and agreed to. A higher current price starts nothing (AGB: the shown price applies). */
      maxCredits?: number;
      /** Channel that starts the job; the Studio ("web") unless an API client says otherwise. */
      origin?: JobOrigin;
      /** The API key behind an MCP or CLI call, so the statement can show what each key spent. */
      apiKeyId?: string;
      /** Spending limit of that key: at most `credits` within the last `windowMs` (refunds excluded). */
      keyLimit?: { credits: number; windowMs: number };
      /** The preset behind the job. Its views show the preset instead of the recipe prompt (prompts stay on the server). */
      recipe?: RecipeTag;
      /** A consent the person confirmed in Tevyon (core/consent.ts), for jobs with consentImages started outside the Studio. */
      consentId?: string;
    } = {},
  ) {
    // A retry gets its job back first: it started and is charged, whatever changed since (a paused model, a new price).
    if (opts.idempotencyKey) {
      const existing = await repo.findByKey(accountId, opts.idempotencyKey);
      if (existing) return { ok: true as const, job: view(existing) };
    }
    const p = prepare(jobType, input);
    if (!p.ok) return p;
    const foreign = foreignInput(accountId, p.params);
    if (foreign) return { ok: false as const, error: "invalid_params" as const, issues: [`${foreign}: must be one of your uploads`] };
    const missing = unattachedMentions(p.params);
    if (missing.length) return { ok: false as const, error: "invalid_params" as const, issues: missing.map((m) => `references: ${m} is not attached`) };
    // Real people over the API, MCP or the CLI: `consent: true` is what an agent can type itself, so the job needs a
    // consent a person confirmed in Tevyon for exactly these pictures. In the Studio the person ticks the box.
    const consentImages = p.def.consentImages?.(p.params);
    const needsConsent = consentImages !== undefined && (opts.origin ?? "web") !== "web";
    if (needsConsent) {
      const c = deps.consent ? await deps.consent.check(accountId, opts.consentId, jobType, consentImages) : ({ ok: false, error: "consent_required" } as const);
      if (!c.ok) return { ok: false as const, error: c.error };
    }
    if (opts.maxCredits !== undefined && p.credits > opts.maxCredits) return { ok: false as const, error: "price_changed" as const, credits: p.credits };
    if ((await repo.balance(accountId)) < p.credits) return { ok: false as const, error: "insufficient_credits" as const };
    const apiKeyId = opts.apiKeyId && UUID.test(opts.apiKeyId) ? opts.apiKeyId : undefined;
    const keyLimit = apiKeyId && opts.keyLimit ? { credits: opts.keyLimit.credits, since: now() - opts.keyLimit.windowMs } : undefined;
    // Early check, so a key over its limit costs no prompt writing; create() checks again atomically.
    if (apiKeyId && keyLimit) {
      const used = await repo.spentByKey(apiKeyId, keyLimit.since);
      if (used + p.credits > keyLimit.credits) return { ok: false as const, error: "key_limit_reached" as const, limit: keyLimit.credits, used };
    }

    // Draft → final: with the same prompt skill and the same words, the final reuses the draft's written prompt,
    // so only the settings change. Never another account's job, never a failed draft
    // (a moderated prompt would only be blocked again).
    const base = opts.basedOn && UUID.test(opts.basedOn) ? await repo.get(opts.basedOn) : undefined;
    const skillName = (id: string) => id.split("@")[0];
    const reuse =
      base && base.accountId === accountId && base.status !== "failed" && base.providerParams && base.promptSkill &&
      skillName(base.promptSkill) === skillName(prompting.skillOf(jobType)) && base.params.prompt === p.params.prompt;
    // The worker writes the prompt (about 2.5 s) just before the job goes to the vendor, so the start answers at once.
    // An exact prompt (the caller already applied the skill) is only tidied, here and now.
    const plan: { skill: string; params?: Record<string, unknown> } = reuse
      ? { skill: base.promptSkill!, params: { ...p.params, prompt: base.providerParams!.prompt } }
      : opts.promptMode === "exact"
        ? await prompting.compile(jobType, p.params, "exact")
        : { skill: prompting.skillOf(jobType) };
    const id = newId();
    // A consent starts one job: taken for this job id in one statement, so two starts at once never share it.
    if (needsConsent && !(await deps.consent!.use(opts.consentId!, id))) return { ok: false as const, error: "consent_used" as const };
    // A consent taken for a job that is then refused (credits, key limit, database) goes back, so the agent can retry.
    const giveBack = () => (needsConsent ? deps.consent!.release(opts.consentId!, id) : Promise.resolve());
    const res = await repo.create(
      {
        id, accountId, jobType, model: p.def.model, credits: p.credits, params: opts.recipe ? { ...p.params, recipe: opts.recipe } : p.params, createdAt: now(),
        ...(plan.params ? { providerParams: plan.params } : {}), promptSkill: plan.skill, origin: opts.origin ?? "web",
        ...(apiKeyId ? { apiKeyId } : {}),
      },
      opts.idempotencyKey,
      keyLimit ? { keyLimit } : undefined,
    ).catch(async (e) => {
      await giveBack().catch(() => {});
      throw e;
    });
    if (!res.ok) await giveBack();
    if (res.ok && res.job.status === "queued") deps.onQueued?.(res.job.id);
    return res.ok ? { ok: true as const, job: view(res.job) } : res;
  }

  async function get(accountId: string, jobId: string): Promise<JobView | undefined> {
    const r = await repo.get(jobId);
    return r && r.accountId === accountId ? view(r) : undefined;
  }

  async function list(accountId: string): Promise<JobView[]> {
    return (await repo.list(accountId)).map(view);
  }

  async function fail(r: JobRecord, error: JobFailure, detail?: string, costUsd?: number) {
    log?.({ jobId: r.id, error, ...(detail === undefined ? {} : { detail }) });
    await repo.fail(r.id, error, detail, costUsd);
  }

  /** Stores what the vendor answered. False when there was nothing new (still rendering). */
  async function apply(r: JobRecord, result: ProviderResult): Promise<boolean> {
    if (result.state === "pending") {
      // Still rendering and nothing new to store: no database write for every status check.
      if (r.status === "running" && r.handle === result.handle && r.unreachable === 0) return false;
      await repo.markRunning(r.id, result.handle);
      return true;
    }
    if (result.state === "completed") {
      // A finished answer without a single file is no result: nothing to charge for, the credits go back.
      if (result.outputs.length === 0) {
        await fail(r, "generation_failed", "completed without outputs", result.costUsd);
        return true;
      }
      const outputs = await Promise.all(
        result.outputs.map(async (o, i) => ({
          url: await media.put(`${r.id}/${i}`, deps.label ? deps.label(o.data, o.contentType) : o.data, o.contentType),
          contentType: o.contentType,
        })),
      );
      await repo.succeed(r.id, outputs, result.costUsd);
      return true;
    }
    await fail(r, FAILURE[result.reason], result.detail, result.costUsd);
    return true;
  }

  const waiters = new Map<string, Set<() => void>>();
  /**
   * Resolves as soon as this process moves the job on (new status or result), at the latest after `ms`.
   * Changes made by another process are not seen: callers read the job again either way.
   */
  function waitFor(jobId: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const set = waiters.get(jobId) ?? new Set<() => void>();
      waiters.set(jobId, set);
      const wake = () => {
        clearTimeout(timer);
        set.delete(wake);
        if (set.size === 0) waiters.delete(jobId);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      set.add(wake);
    });
  }

  // ── Worker ──────────────────────────────────────────────────────────────────────────────────────────────────────
  // Jobs move side by side, within limits; a job is never advanced twice at the same time.
  const limits = {
    submits: deps.worker?.submits ?? 8, perAccount: deps.worker?.perAccount ?? 4, polls: deps.worker?.polls ?? 16,
    // Above the provider's own call limits (submit, poll, downloads), so its finer answer comes first.
    submitMs: deps.worker?.submitTimeoutMs ?? 300_000, pollMs: deps.worker?.pollTimeoutMs ?? 240_000,
    // A vendor outage of a few seconds no longer fails jobs: 3 s, 6 s, 12 s … up to a minute between tries.
    retryBaseMs: deps.worker?.retryBaseMs ?? 3_000, retryMaxMs: deps.worker?.retryMaxMs ?? 60_000,
    image: deps.worker?.imageDeadlineMs ?? 15 * 60_000, video: deps.worker?.videoDeadlineMs ?? 60 * 60_000,
    leaseMs: deps.worker?.leaseMs ?? 30_000,
  };
  const workerId = deps.worker?.id ?? crypto.randomUUID();
  let renewedAt = 0;
  const inFlight = new Map<string, { accountId: string; submitting: boolean }>();
  /** When a job that failed a call may be tried again. */
  const retryAt = new Map<string, number>();
  /** Answers the vendor already gave that could not be stored yet: the next try stores them instead of asking (and paying) again. */
  const unsaved = new Map<string, ProviderResult>();

  /** Pause before the next try after `streak` failures in a row, with ±20 % jitter so retries do not arrive in waves. */
  const pause = (streak: number) =>
    Math.min(limits.retryBaseMs * 2 ** Math.max(0, streak - 1), limits.retryMaxMs) * (0.8 + Math.random() * 0.4);

  /** Due jobs within the free capacity, taking turns between accounts (oldest job first within each account). */
  function choose(due: JobRecord[]): JobRecord[] {
    const busy = { submits: 0, polls: 0, byAccount: new Map<string, number>() };
    for (const f of inFlight.values()) {
      if (!f.submitting) busy.polls++;
      else {
        busy.submits++;
        busy.byAccount.set(f.accountId, (busy.byAccount.get(f.accountId) ?? 0) + 1);
      }
    }
    const turns = new Map<string, JobRecord[]>();
    for (const r of due) turns.set(r.accountId, [...(turns.get(r.accountId) ?? []), r]);
    const chosen: JobRecord[] = [];
    while (turns.size > 0) {
      for (const [account, queue] of turns) {
        const r = queue.shift()!;
        if (queue.length === 0) turns.delete(account);
        if (r.status !== "queued") {
          if (busy.polls < limits.polls) (busy.polls++, chosen.push(r));
          continue;
        }
        const mine = busy.byAccount.get(account) ?? 0;
        if (busy.submits < limits.submits && mine < limits.perAccount) {
          busy.submits++;
          busy.byAccount.set(account, mine + 1);
          chosen.push(r);
        }
      }
    }
    return chosen;
  }

  /**
   * Reads the active jobs, chooses the ones to advance now and claims them in the database. Chosen jobs are marked
   * in flight synchronously, so two passes of this worker never take the same job; the claim keeps other workers
   * away and reads each job afresh, so a list read just before a job finished never sends it to the vendor again.
   */
  async function pick(): Promise<JobRecord[]> {
    const active = await repo.active();
    const t = now();
    const ids = new Set(active.map((r) => r.id));
    for (const id of [...retryAt.keys(), ...unsaved.keys()]) {
      if (!ids.has(id) && !inFlight.has(id)) (retryAt.delete(id), unsaved.delete(id));
    }
    const chosen = choose(active.filter((r) => !inFlight.has(r.id) && (retryAt.get(r.id) ?? 0) <= t));
    if (chosen.length === 0) return [];
    for (const r of chosen) inFlight.set(r.id, { accountId: r.accountId, submitting: r.status === "queued" });
    let claimed: JobRecord[];
    try {
      claimed = await repo.claim(chosen.map((r) => r.id), workerId, t, t + limits.leaseMs);
    } catch (e) {
      for (const r of chosen) inFlight.delete(r.id);
      throw e;
    }
    const got = new Set(claimed.map((r) => r.id));
    for (const r of chosen) if (!got.has(r.id)) inFlight.delete(r.id); // another worker has it, or it just finished
    for (const r of claimed) inFlight.set(r.id, { accountId: r.accountId, submitting: r.status === "queued" });
    return claimed;
  }

  /** Renews this worker's claims while vendor calls run (a long image render outlasts one claim). */
  async function renewClaims() {
    const t = now();
    if (inFlight.size === 0 || t - renewedAt < limits.leaseMs / 3) return;
    renewedAt = t;
    const mine = [...inFlight.keys()];
    const kept = new Set((await repo.claim(mine, workerId, t, t + limits.leaseMs)).map((r) => r.id));
    // A job that finished during the renewal drops out on its own; only one still in flight may have gone elsewhere.
    const missing = mine.filter((id) => inFlight.has(id) && !kept.has(id)).length;
    if (missing > 0) warn(`claim not renewed for ${missing} job(s): finished meanwhile or taken by another worker`);
  }

  /** Moves one job forward. Never throws: the server runs it unawaited, and a rejection would end the process. */
  async function advance(r: JobRecord) {
    try {
      await step(r);
    } catch (e) {
      // Our database or media store failed, not the vendor. The answer stays in `unsaved`; try again soon.
      retryAt.set(r.id, now() + pause(1));
      warn(`${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      inFlight.delete(r.id);
    }
  }

  /** One provider call within the worker's own time limit: submit when queued, ask for the status when running. */
  async function call(r: JobRecord, def: JobTypeDef, provider: Provider): Promise<ProviderResult> {
    const submitting = r.status === "queued";
    const ms = submitting ? limits.submitMs : limits.pollMs;
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`no answer within ${ms} ms`));
        controller.abort(new Error("worker time limit"));
      }, ms);
    });
    try {
      return await Promise.race([
        submitting
          ? provider.submit({ kind: def.kind, providerModel: def.route.providerModel, params: toVendor(def, r.providerParams ?? withoutRecipe(r.params)) }, controller.signal)
          : provider.poll(r.handle!, controller.signal),
        limit,
      ]);
    } catch (e) {
      // A start call may have reached the vendor: it is never sent again (provider.ts), the job ends as timed out.
      if (timedOut && submitting) return { state: "failed", reason: "timeout", detail: `start call without answer after ${ms} ms` };
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * One step of one job: submit it when queued, ask for its status when running, then store what came back.
   * Asking and storing are separate: once the vendor answered, a failure to store never leads to asking again.
   */
  async function step(r: JobRecord) {
    let result = unsaved.get(r.id);
    if (!result) {
      const def = register.get(r.jobType);
      const age = now() - r.createdAt;
      if (age > (def?.kind === "image" ? limits.image : limits.video)) {
        // Credits are never held forever, whatever the vendor or our own code does.
        result = { state: "failed", reason: "timeout", detail: `still ${r.status} after ${Math.round(age / 60_000)} min` };
      } else {
        const provider = def && providers[def.route.provider];
        if (!def || !provider || (r.status === "running" && !r.handle)) return;
        if (r.status === "queued" && !r.providerParams) {
          // The prompt skill writes the prompt now (the start did not wait for it), and it is stored before the job
          // goes out, so a worker after a restart sends the same prompt. Identical jobs started together share one write.
          const plan = await compileOnce(r.accountId, r.jobType, withoutRecipe(r.params), "auto");
          // Every prompt should pass the skill: a fallback to the user's own words is worth a look (writer down, guard).
          if (plan.fallback) deps.warn?.(`prompt skill ${plan.skill} not applied to job ${r.id}: ${plan.fallback}`);
          if (plan.slip) deps.warn?.(`prompt skill ${plan.skill} rule kept broken in job ${r.id}: ${plan.slip}`);
          await repo.setPlan(r.id, plan.params, plan.skill);
          r = { ...r, providerParams: plan.params, promptSkill: plan.skill };
        }
        try {
          result = await call(r, def, provider);
        } catch (e) {
          // The vendor did not take or answer the call. Ask again after a pause that grows with every failure in a row.
          // A job the vendor never took fails after a few tries; a running one is checked until its deadline.
          const streak = await repo.markUnreachable(r.id);
          if (r.status !== "queued" || streak < maxUnreachable) {
            retryAt.set(r.id, now() + pause(streak));
            return;
          }
          result = { state: "failed", reason: "provider_error", detail: e instanceof Error ? e.message : String(e) };
        }
      }
      unsaved.set(r.id, result);
    }
    const changed = await apply(r, result);
    unsaved.delete(r.id);
    retryAt.delete(r.id);
    if (changed) for (const wake of [...(waiters.get(r.id) ?? [])]) wake();
  }

  /**
   * One worker pass: submit queued jobs and poll running ones, side by side, and wait until they are done. On Vercel
   * every request runs its own pass and no pump() comes by, so the pass renews its claims itself while a vendor call
   * outlasts one claim; otherwise another instance would take the job and send it to the vendor again.
   */
  async function tick() {
    const renew = setInterval(
      () => void renewClaims().catch((e) => warn(`renewing claims failed: ${e instanceof Error ? e.message : String(e)}`)),
      limits.leaseMs / 3,
    );
    try {
      await Promise.all((await pick()).map(advance));
    } finally {
      clearInterval(renew);
    }
  }

  let scan: Promise<void> | undefined;
  let again = false;
  /**
   * The server's worker pass: hands due jobs to the vendor and returns without waiting for any of them, so a slow
   * vendor never holds up the next pass. Calls during a scan add one more scan instead of running side by side.
   */
  function pump(): Promise<void> {
    if (scan) {
      again = true;
      return scan;
    }
    scan = (async () => {
      try {
        await renewClaims().catch((e) => warn(`renewing claims failed: ${e instanceof Error ? e.message : String(e)}`));
        do {
          again = false;
          for (const r of await pick()) void advance(r);
        } while (again);
      } finally {
        scan = undefined;
      }
    })();
    return scan;
  }

  return { quote, start, get, list, tick, pump, waitFor };
}
