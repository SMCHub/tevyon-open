import { catalog } from "@/core/catalog";
import { reuseOutput } from "@/core/reuse";
import {
  composeMarketingJob,
  composeUgcVideo,
  findStyle,
  flowRules,
  MS_CATEGORIES,
  MS_STYLES,
  msRecipeTag,
  publicStyle,
  publicTemplates,
  type MsInputs,
  type MsRunInputs,
} from "@/core/marketing";
import type { runtime } from "./runtime";

type Runtime = Awaited<ReturnType<typeof runtime>>;

/** Placeholder uploads for a price: the files never change the price, only how many there are. */
const SAMPLE = (n: string) => `/api/media/uploads/00000000-0000-4000-8000-000000000000/${n}.jpg`;
export const MAX_BATCH = 4;

/** The job types the live register offers right now (paused and retired models count as missing). */
export function offers(rt: Runtime) {
  return (jobType: string) => catalog.get(jobType) !== undefined && rt.models.availability(jobType).ok;
}

/** Categories and styles with the price of one run at the style's defaults (product photo, no avatar). */
export function marketingOverview(rt: Runtime) {
  const has = offers(rt);
  const styles = MS_STYLES.map((s) => {
    const pub = publicStyle(s, has);
    if (!pub.available) return { ...pub, credits: null };
    const q = quoteInputs(rt, s.id, sampleInputs(s.id, {}));
    return { ...pub, credits: q.ok ? q.credits : null };
  });
  // A template costs what its base style costs (same model, same settings).
  const price = new Map(styles.map((s) => [s.id, s.credits]));
  const templates = publicTemplates(has).map((t) => ({ ...t, credits: t.available ? price.get(t.base ?? "") ?? null : null }));
  return { categories: MS_CATEGORIES, styles, templates };
}

/** Whether the client sent a file for a slot; for a price only the presence matters. */
export type MsShape = { product?: boolean; avatar?: boolean; adReference?: boolean; wish?: string; aspect?: string; duration?: number };

function sampleInputs(styleId: string, shape: MsShape): MsInputs {
  const style = findStyle(styleId);
  const rules = style ? flowRules(style.flow) : undefined;
  const wantsProduct = shape.product ?? rules?.product !== "none";
  return {
    ...(wantsProduct ? { product: SAMPLE("product") } : {}),
    ...(shape.avatar || rules?.avatar === "required" ? { avatar: SAMPLE("avatar") } : {}),
    ...(shape.adReference ? { adReference: SAMPLE("reference") } : {}),
    // Spoken styles need a line and text-only posters a description; neither changes the price.
    wish: shape.wish?.trim() || "Sample",
    ...(shape.aspect ? { aspect: shape.aspect } : {}),
    ...(shape.duration !== undefined ? { duration: shape.duration } : {}),
  };
}

/** Price of one run; UGC adds its second step (the speaking video), so the button shows the whole chain. */
function quoteInputs(rt: Runtime, styleId: string, inputs: MsInputs) {
  const job = composeMarketingJob(styleId, inputs, offers(rt));
  if (!job.ok) return job;
  const q = rt.jobs.quote(job.jobType, job.params);
  if (!q.ok) return { ok: false as const, error: q.error };
  if (!job.next) return { ok: true as const, credits: q.credits };
  const video = composeUgcVideo(styleId, { frame: SAMPLE("frame"), wish: job.next.line, duration: job.next.duration, aspect: job.next.aspect }, offers(rt));
  if (!video.ok) return video;
  const v = rt.jobs.quote(video.jobType, video.params);
  if (!v.ok) return { ok: false as const, error: v.error };
  return { ok: true as const, credits: q.credits + v.credits, parts: { frame: q.credits, video: v.credits } };
}

/** Price of one run for the settings in the panel. */
export function marketingQuote(rt: Runtime, styleId: string, shape: MsShape) {
  return quoteInputs(rt, styleId, sampleInputs(styleId, shape));
}

export type MsStartBody = {
  styleId?: unknown; product?: unknown; avatar?: unknown; adReference?: unknown; wish?: unknown; aspect?: unknown; duration?: unknown;
  count?: unknown; consent?: unknown; maxCredits?: unknown;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Parses the start body into inputs. Files are checked again by jobs.start (own uploads only). */
export function parseMsBody(body: MsStartBody) {
  const styleId = str(body.styleId) ?? "";
  const inputs: MsInputs = {
    ...(str(body.product) ? { product: str(body.product) } : {}),
    ...(str(body.avatar) ? { avatar: str(body.avatar) } : {}),
    ...(str(body.adReference) ? { adReference: str(body.adReference) } : {}),
    ...(str(body.wish) ? { wish: str(body.wish) } : {}),
    ...(str(body.aspect) ? { aspect: str(body.aspect) } : {}),
    ...(typeof body.duration === "number" ? { duration: body.duration } : {}),
  };
  const count = typeof body.count === "number" && Number.isInteger(body.count) ? body.count : 1;
  return { styleId, inputs, count };
}

export type MsStartOptions = Parameters<Runtime["jobs"]["start"]>[3];

/**
 * Starts one style `count` times as separate jobs (a batch of images is n single requests),
 * each with its own idempotency key derived from the caller's. An avatar is a real person: only with consent.
 * maxCredits is the price of one run the caller showed.
 */
export async function startMarketing(
  rt: Runtime, accountId: string, body: MsStartBody, opts: { idempotencyKey?: string } & Omit<NonNullable<MsStartOptions>, "idempotencyKey" | "promptMode" | "recipe">,
) {
  const { styleId, inputs, count } = parseMsBody(body);
  const style = findStyle(styleId);
  if (!style) return { ok: false as const, error: "unknown_style" as const };
  const rules = flowRules(style.flow);
  if (count < 1 || count > MAX_BATCH || (count > 1 && !rules.batch)) return { ok: false as const, error: "batch_size_invalid" as const };
  if (inputs.avatar && body.consent !== true) return { ok: false as const, error: "consent_required" as const };

  const job = composeMarketingJob(styleId, inputs, offers(rt));
  if (!job.ok) return job;
  const recipe = msRecipeTag(style, inputs.wish, {
    product: inputs.product, avatar: inputs.avatar, adReference: inputs.adReference, aspect: inputs.aspect, duration: inputs.duration,
    ...(count > 1 ? { count } : {}),
  });
  // UGC: the shown price covers both steps; step 1 may cost at most its own part of it.
  let maxCredits = opts.maxCredits;
  let next: { styleId: string; wish: string; duration: number; aspect: string; credits: number } | undefined;
  if (job.next) {
    const q = quoteInputs(rt, styleId, inputs);
    if (!q.ok || !("parts" in q) || !q.parts) return q.ok ? { ok: false as const, error: "invalid_params" as const } : q;
    if (opts.maxCredits !== undefined && q.credits > opts.maxCredits) return { ok: false as const, error: "price_changed" as const, credits: q.credits };
    maxCredits = q.parts.frame;
    next = { styleId, wish: job.next.line, duration: job.next.duration, aspect: job.next.aspect, credits: q.parts.video };
  }
  const jobs = [];
  for (let i = 0; i < count; i++) {
    const idempotencyKey = opts.idempotencyKey ? (count > 1 ? `${opts.idempotencyKey}:${i}` : opts.idempotencyKey) : undefined;
    const res = await rt.jobs.start(accountId, job.jobType, job.params, {
      ...opts, idempotencyKey, promptMode: "exact", recipe, ...(maxCredits !== undefined ? { maxCredits } : {}),
    });
    if (!res.ok) {
      // The first refusal says it all (price, credits, limit); jobs already started keep running and are returned.
      if (jobs.length === 0) return res;
      return { ok: true as const, jobs, partial: res.error, ...(next ? { next } : {}) };
    }
    jobs.push(res.job);
  }
  return { ok: true as const, jobs, ...(next ? { next } : {}) };
}

export type UgcContinueBody = { frameJobId?: unknown; styleId?: unknown; wish?: unknown; duration?: unknown; aspect?: unknown; maxCredits?: unknown };

/**
 * UGC step 2: the caller's finished still of this style speaks the line. Idempotent per still (key "ugc:<still>"),
 * so a second click or a reload never starts and charges a second video.
 */
export async function continueUgc(
  rt: Runtime, accountId: string, body: UgcContinueBody, opts: Omit<NonNullable<MsStartOptions>, "idempotencyKey" | "promptMode" | "recipe">,
) {
  const frameJobId = str(body.frameJobId);
  const styleId = str(body.styleId) ?? "";
  const style = findStyle(styleId);
  if (!frameJobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(frameJobId) || !style) return { ok: false as const, error: "invalid_params" as const };
  const frameJob = await rt.jobs.get(accountId, frameJobId);
  const tag = frameJob?.params.recipe as { id?: unknown; inputs?: MsRunInputs } | undefined;
  if (!frameJob || tag?.id !== `ms:${styleId}`) return { ok: false as const, error: "not_found" as const };
  if (frameJob.status !== "succeeded") return { ok: false as const, error: "frame_not_ready" as const };

  const copy = await reuseOutput(
    { getJob: (a, j) => rt.jobs.get(a, j), read: async (url) => (await rt.media.read(url.replace(/^\/api\/media\//, "")))?.data, media: rt.media },
    accountId, frameJobId, 0,
  );
  if (!copy.ok) return { ok: false as const, error: copy.error };
  const video = composeUgcVideo(styleId, {
    frame: copy.url,
    ...(str(body.wish) ? { wish: str(body.wish) } : {}),
    ...(typeof body.duration === "number" ? { duration: body.duration } : {}),
    ...(str(body.aspect) ? { aspect: str(body.aspect) } : {}),
  }, offers(rt));
  if (!video.ok) return video;
  const res = await rt.jobs.start(accountId, video.jobType, video.params, {
    ...opts, idempotencyKey: `ugc:${frameJobId}`, promptMode: "exact", recipe: msRecipeTag(style, str(body.wish), tag.inputs ?? {}),
  });
  return res.ok ? { ok: true as const, job: res.job } : res;
}
