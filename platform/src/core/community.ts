import type { JobView } from "./jobs";
import type { Db } from "./postgres-repository";

/**
 * Community: a public profile per account and the creations their owners publish.
 * Private by default: nothing of an account is public until its owner chose a handle, accepted the community rules and
 * published a creation; each creation can go private again at any time. What others see of a creation is a snapshot
 * built from a whitelist when it is published (never uploads, never a preset's recipe prompt, never an account id), so
 * the feed never reads a job's own params.
 */
export type Kind = "image" | "video";

/** What publishing reads of a job: the owner's own view of it (jobs.get), never the repository record. */
export type PublishableJob = Pick<JobView, "id" | "jobType" | "model" | "status" | "outputs" | "params">;

/** What others see of a creation, stored with the publication. */
export type CreationData = {
  jobType: string;
  model: string;
  media: { url: string; contentType: string };
  aspect?: string;
  duration?: number;
  resolution?: string;
  audio?: boolean;
  /** The owner's own prompt while they show it, else null. A preset job never shows one (its recipe stays ours). */
  prompt: string | null;
  /** A preset job: the preset, and the owner's wish while they show their prompts. */
  preset?: { id: string; title: string; wish?: string };
};

const PROMPT_MAX = 5000;
const SETTING = /^[\w:.-]{1,12}$/;
const UPLOADS = "/api/media/uploads/";

/** Whether the job was made from the owner's own files (a photo, references, a video): publishing them needs consent. */
const usesUploads = (params: Record<string, unknown>) => JSON.stringify(params).includes(UPLOADS);

/** A preset job's public marker: id, title and the owner's wish. Never the recipe prompt, never its inputs. */
function presetOf(params: Record<string, unknown>): { id: string; title: string; wish?: string } | undefined {
  const r = params.recipe;
  if (!r || typeof r !== "object") return undefined;
  const { id, title, wish } = r as Record<string, unknown>;
  if (typeof id !== "string" || !id) return undefined;
  const w = line(wish).slice(0, 300);
  return { id: id.slice(0, 80), title: line(title).slice(0, 80) || id.slice(0, 80), ...(w ? { wish: w } : {}) };
}

/**
 * What others may see of a job, read from a whitelist of its parameters: the result, model, format, length, sound and
 * the owner's prompt while they show it. Everything else (uploads, references, a preset's recipe prompt and inputs,
 * seeds, the account) stays out by construction.
 */
function snapshot(job: PublishableJob, showPrompt: boolean): CreationData {
  const p = job.params;
  const out = job.outputs[0]!;
  const preset = presetOf(p);
  const prompt = !preset && showPrompt && typeof p.prompt === "string" ? p.prompt.trim().slice(0, PROMPT_MAX) : "";
  return {
    jobType: job.jobType,
    model: job.model,
    media: { url: out.url, contentType: out.contentType },
    ...(typeof p.aspect_ratio === "string" && SETTING.test(p.aspect_ratio) ? { aspect: p.aspect_ratio } : {}),
    ...(typeof p.duration === "number" && p.duration > 0 && p.duration <= 600 ? { duration: p.duration } : {}),
    ...(typeof p.resolution === "string" && SETTING.test(p.resolution) ? { resolution: p.resolution } : {}),
    ...(typeof p.generate_audio === "boolean" ? { audio: p.generate_audio } : {}),
    prompt: prompt || null,
    ...(preset ? { preset: { id: preset.id, title: preset.title, ...(showPrompt && preset.wish ? { wish: preset.wish } : {}) } } : {}),
  };
}

/** Who made a public creation: never the account, only what its owner chose to show. */
export type Creator = { handle: string; name: string; avatar: string | null };
/** A public creation in the community. `liked`: whether the viewer likes it (only when the list has a viewer). */
export type Creation = CreationData & { id: string; kind: Kind; creator: Creator; publishedAt: number; likes: number; liked?: boolean };

/**
 * An account's profile as its owner sees it; `since`: when it was created. `avatar`: the public address of the chosen
 * picture (/api/community/<handle>/avatar?v=…), never the upload it came from.
 */
export type Profile = {
  handle: string; name: string; bio: string; showPrompts: boolean; since: number; avatar: string | null;
  /** Only while the operator keeps the profile out of the community: the reason its owner reads. */
  hidden?: string;
};
export type ProfileError =
  | "invalid_handle" | "reserved_handle" | "handle_taken" | "invalid_name" | "reserved_name" | "invalid_bio" | "invalid_avatar" | "terms_required";

/** Lowercase letters, digits and underscores, 3 to 20 long, at least one letter. */
const HANDLE = /^(?=[a-z0-9_]*[a-z])[a-z0-9_]{3,20}$/;
/** Pages and roles of Tevyon: nobody poses as staff or shadows a page with their handle. */
const RESERVED_HANDLES = new Set([
  "admin", "administrator", "root", "system", "support", "hilfe", "help", "info", "kontakt", "contact", "team", "staff", "mod",
  "moderator", "moderation", "official", "offiziell", "security", "abuse", "legal", "privacy", "datenschutz", "agb", "impressum",
  "billing", "api", "mcp", "cli", "oauth", "login", "logout", "signup", "register", "device", "settings", "account", "konto",
  "profile", "profil", "community", "explore", "entdecken", "image", "video", "director", "presets", "preset", "marketing",
  "assets", "credits", "preise", "pricing", "jobs", "media", "me", "user", "users", "anonymous", "anonym", "null", "undefined",
  "new", "edit",
]);
/** The brand, in a handle or a name. */
const BRAND = /tevyon|tachyon/i;
export const NAME_MAX = 40;
export const BIO_MAX = 160;

/** One line of text: control characters and runs of white space become one space, trimmed. */
const line = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "");
const chars = (s: string) => [...s].length;

/** “@Lena_Creates ” → “lena_creates”. */
export function normalizeHandle(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().replace(/^@/, "").toLowerCase() : "";
}

export type ProfileRow = {
  accountId: string; handle: string; name: string; bio: string; showPrompts: boolean; termsAt: number; createdAt: number; updatedAt: number;
  /** One of the owner's uploads (/api/media/uploads/<account>/…), server-only. */
  avatar: string | null;
  /** Moderation of the profile: changed only by the operator (hideProfile, unhideProfile, dismissProfile), never by saving. */
  hiddenAt: number | null;
  hiddenReason: string | null;
  reviewedAt: number | null;
};
/** What saving a profile writes: everything but the moderation marks. */
export type SavedProfileRow = Omit<ProfileRow, "hiddenAt" | "hiddenReason" | "reviewedAt">;

/** The public address of a profile's picture; the version changes with every change of the profile. */
const avatarUrl = (handle: string, avatar: string | null, version: number) => (avatar ? `/api/community/${handle}/avatar?v=${version}` : null);
const toProfile = (r: ProfileRow): Profile => ({
  handle: r.handle, name: r.name, bio: r.bio, showPrompts: r.showPrompts, since: r.createdAt, avatar: avatarUrl(r.handle, r.avatar, r.updatedAt),
  ...(r.hiddenAt !== null ? { hidden: r.hiddenReason ?? "reports" } : {}),
});
/** An image the account uploaded itself (scanned like every upload). */
const ownImage = (accountId: string, v: unknown): v is string =>
  typeof v === "string" && v.length < 300 && new RegExp(`^/api/media/uploads/${accountId}/[A-Za-z0-9_-]+\\.(png|jpe?g|webp)$`).test(v);
export type PublicationRow = {
  jobId: string; accountId: string; kind: Kind; showPrompt: boolean; data: CreationData; publishedAt: number | null; updatedAt: number;
  /** Moderation: set by reports or the operator, changed only by hide() and unhide(), never by publishing. */
  hiddenAt: number | null;
  hiddenReason: string | null;
  /** When the operator last restored it: reports from before no longer count. */
  reviewedAt: number | null;
  /** How many accounts like it; changes only with a like (store.like/unlike). */
  likes: number;
};
/** What publishing writes: everything but the moderation marks and the likes. */
export type PublishedRow = Omit<PublicationRow, "hiddenAt" | "hiddenReason" | "reviewedAt" | "likes">;
/**
 * One of the account's own publications, as its owner sees it. hidden: taken out of the community by moderation, with
 * the reason ("reports" while reports wait for the operator, else the operator's own words); publishedAt is null once
 * its owner made it private.
 */
export type OwnPublication = { jobId: string; state: "public" | "hidden"; showPrompt: boolean; publishedAt: number | null; reason?: string };
export type PublishError = "profile_required" | "not_found" | "not_ready" | "consent_required" | "hidden";

export const REPORT_REASONS = ["rights", "person", "sexual", "violence", "minors", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportRow = { jobId: string; accountId: string; reason: ReportReason; note: string; at: number };
/** A report about a profile: whom it is about (accountId) and who reported (reporterId, never shown). */
export type ProfileReportRow = { accountId: string; reporterId: string; reason: ReportReason; note: string; at: number };

/** What the operator reads about a report: why, the note, when. Never who reported. */
export type QueueReport = { reason: ReportReason; note: string; at: number };
/** A creation waiting for the operator: reported since the last review, or hidden. */
export type QueueCreation = {
  jobId: string; handle: string | null; kind: Kind; media: { url: string; contentType: string };
  state: "public" | "private" | "hidden"; reason?: string; reports: QueueReport[];
};
/** A profile waiting for the operator; avatar: the uploaded file itself (a hidden profile's picture is public no more). */
export type QueueProfile = { handle: string; name: string; avatar: string | null; state: "visible" | "hidden"; reason?: string; reports: QueueReport[] };
export type QueueRows = {
  creations: (PublicationRow & { handle: string | null; reports: QueueReport[] })[];
  profiles: (ProfileRow & { reports: QueueReport[] })[];
};
/** Distinct reports (since the operator last looked) that take a creation out of the community until it is reviewed. */
export const REPORTS_TO_HIDE = 3;
/** Reports that hide a creation at once: nothing involving minors stays up while it waits for a person. */
const HIDE_AT_ONCE: ReportReason[] = ["minors"];
export type FeedRow = PublicationRow & { handle: string; name: string; avatar: string | null; profileUpdatedAt: number; liked?: boolean };
export type FeedSort = "new" | "popular";
/**
 * before: read only what comes after this creation in the order (newest: publishedAt, then job id; popular: likes
 * first). viewer: mark what this account likes.
 */
export type FeedQuery = {
  limit: number; kind?: Kind; accountId?: string; sort?: FeedSort; viewer?: string; before?: { likes?: number; at: number; id: string };
  /** Only creations of the accounts this account follows. */
  followedBy?: string;
};
/** What the community shows of a profile. */
export type PublicProfile = Omit<Profile, "showPrompts" | "hidden">;
export type FeedOptions = { kind?: unknown; before?: unknown; limit?: unknown; sort?: unknown; following?: unknown };
export type FeedPage = { items: Creation[]; next: string | null };

/** Storage of profiles and publications. */
export interface CommunityStore {
  profile(accountId: string): Promise<ProfileRow | undefined>;
  profileByHandle(handle: string): Promise<ProfileRow | undefined>;
  /** Creates or updates a profile; an existing one keeps its moderation marks. */
  saveProfile(row: SavedProfileRow): Promise<"ok" | "handle_taken">;
  publication(jobId: string): Promise<PublicationRow | undefined>;
  /** Inserts or updates a publication; an existing row keeps its moderation marks. */
  savePublication(row: PublishedRow): Promise<void>;
  /** The account's publications that are public or hidden by moderation, newest first. */
  publications(accountId: string): Promise<PublicationRow[]>;
  /** Public creations with their creator, newest first. */
  feed(q: FeedQuery): Promise<FeedRow[]>;
  /** How many creations of the account are public, per kind. */
  counts(accountId: string): Promise<Record<Kind, number>>;
  /** Moderation marks. False when there is no such publication. */
  hide(jobId: string, at: number, reason: string): Promise<boolean>;
  unhide(jobId: string, at: number): Promise<boolean>;
  /** One report per account and creation; a repeat changes nothing (false). */
  addReport(r: ReportRow): Promise<boolean>;
  /** Reports about the creation made after `since`. */
  reportCount(jobId: string, since: number): Promise<number>;
  /** One like per account and creation; the counter changes in the same step. Returns the count after it. */
  like(jobId: string, accountId: string, at: number): Promise<number>;
  unlike(jobId: string, accountId: string): Promise<number>;
  /** One follow per pair; a repeat changes nothing. */
  follow(followerId: string, followeeId: string, at: number): Promise<void>;
  unfollow(followerId: string, followeeId: string): Promise<void>;
  /** How many accounts follow this one, and how many it follows. */
  followCounts(accountId: string): Promise<{ followers: number; following: number }>;
  isFollowing(followerId: string, followeeId: string): Promise<boolean>;
  /** The operator looked at a creation without hiding it: reports before `at` no longer count. */
  dismiss(jobId: string, at: number): Promise<boolean>;
  /** Moderation of profiles, like hide/unhide/dismiss for creations. False when there is no such profile. */
  hideProfile(accountId: string, at: number, reason: string): Promise<boolean>;
  unhideProfile(accountId: string, at: number): Promise<boolean>;
  dismissProfile(accountId: string, at: number): Promise<boolean>;
  /** One report per account and profile; a repeat changes nothing (false). */
  addProfileReport(r: ProfileReportRow): Promise<boolean>;
  /** Reports about the profile made after `since`. */
  profileReportCount(accountId: string, since: number): Promise<number>;
  /** Likes on the account's public creations, together. */
  likesReceived(accountId: string): Promise<number>;
  /** Creations and profiles with reports since their last review, or hidden; each with those reports, newest first. */
  queue(): Promise<QueueRows>;
  /**
   * Deletes the profile and what it shares (with the likes and reports of those creations) and the follows it had;
   * creations moderation took out stay, so a new profile cannot bring them back.
   */
  deleteProfile(accountId: string): Promise<void>;
  /** Removes every trace of the account: profile, creations, likes and follows and reports, given and received. */
  forget(accountId: string): Promise<void>;
}

const FEED_LIMIT = 40;
const FEED_MAX = 60;
/** Where a page continues: “<publishedAt>_<jobId>”, sorted by likes “<likes>.<publishedAt>_<jobId>”. */
const CURSOR = /^(?:(\d{1,9})\.)?(\d{1,16})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** Job ids are UUIDs; anything else is no job (and must not reach a uuid column). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kindOf = (v: unknown): Kind | undefined => (v === "image" || v === "video" ? v : undefined);

export function createCommunity(deps: {
  store: CommunityStore;
  /** The account's own job, or undefined for an unknown or foreign one (jobs.get). */
  job: (accountId: string, jobId: string) => Promise<PublishableJob | undefined>;
  now?: () => number;
}) {
  const { store } = deps;
  const now = deps.now ?? Date.now;

  async function profile(accountId: string): Promise<Profile | null> {
    const row = await store.profile(accountId);
    return row ? toProfile(row) : null;
  }

  /**
   * Creates or changes the account's profile. A new profile needs the community rules accepted (acceptTerms); later
   * changes keep that acceptance and the date the profile began. A changed handle frees the old one.
   */
  async function saveProfile(
    accountId: string,
    input: { handle?: unknown; name?: unknown; bio?: unknown; showPrompts?: unknown; acceptTerms?: unknown; avatar?: unknown },
  ): Promise<{ ok: true; profile: Profile } | { ok: false; error: ProfileError }> {
    const fail = (error: ProfileError) => ({ ok: false as const, error });
    const handle = normalizeHandle(input.handle);
    if (!HANDLE.test(handle)) return fail("invalid_handle");
    if (RESERVED_HANDLES.has(handle) || BRAND.test(handle)) return fail("reserved_handle");
    const name = line(input.name);
    if (!name || chars(name) > NAME_MAX) return fail("invalid_name");
    if (BRAND.test(name)) return fail("reserved_name");
    const bio = line(input.bio);
    if (chars(bio) > BIO_MAX) return fail("invalid_bio");
    // undefined keeps the picture, null removes it, anything else must be one of the account's own image uploads.
    if (input.avatar !== undefined && input.avatar !== null && !ownImage(accountId, input.avatar)) return fail("invalid_avatar");
    const existing = await store.profile(accountId);
    if (!existing && input.acceptTerms !== true) return fail("terms_required");

    const at = now();
    const row: SavedProfileRow = {
      accountId, handle, name, bio,
      showPrompts: typeof input.showPrompts === "boolean" ? input.showPrompts : existing?.showPrompts ?? true,
      termsAt: existing?.termsAt ?? at,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      avatar: input.avatar === undefined ? existing?.avatar ?? null : (input.avatar as string | null),
    };
    if ((await store.saveProfile(row)) === "handle_taken") return fail("handle_taken");
    return {
      ok: true,
      profile: toProfile({ ...row, hiddenAt: existing?.hiddenAt ?? null, hiddenReason: existing?.hiddenReason ?? null, reviewedAt: existing?.reviewedAt ?? null }),
    };
  }

  /**
   * Makes one of the account's finished creations public, or changes what a public one shows (`showPrompt`, default:
   * the profile's choice). A creation made from the owner's uploads needs `consent` (rights and depicted persons) the
   * first time it goes public. Publishing again keeps its place in the feed.
   */
  async function publish(
    accountId: string,
    jobId: string,
    opts: { showPrompt?: boolean; consent?: boolean } = {},
  ): Promise<{ ok: true; publication: OwnPublication } | { ok: false; error: PublishError }> {
    const fail = (error: PublishError) => ({ ok: false as const, error });
    const profile = await store.profile(accountId);
    if (!profile) return fail("profile_required");
    const job = await deps.job(accountId, jobId);
    if (!job) return fail("not_found");
    const out = job.outputs[0];
    // Only the job's own result: the media route opens exactly these files for others.
    if (job.status !== "succeeded" || !out || !out.url.startsWith(`/api/media/${job.id}/`)) return fail("not_ready");
    const existing = await store.publication(jobId);
    if (existing?.hiddenAt != null) return fail("hidden");
    const live = existing?.publishedAt != null;
    if (!live && usesUploads(job.params) && opts.consent !== true) return fail("consent_required");

    const showPrompt = typeof opts.showPrompt === "boolean" ? opts.showPrompt : existing?.showPrompt ?? profile.showPrompts;
    const at = now();
    const publishedAt = live ? existing.publishedAt! : at;
    await store.savePublication({
      jobId, accountId, kind: out.contentType.startsWith("video/") ? "video" : "image", showPrompt, data: snapshot(job, showPrompt), publishedAt, updatedAt: at,
    });
    return { ok: true, publication: { jobId, state: "public", showPrompt, publishedAt } };
  }

  /** Makes a creation private again. Idempotent; only the owner may. */
  async function unpublish(accountId: string, jobId: string) {
    if (!(await deps.job(accountId, jobId))) return { ok: false as const, error: "not_found" as const };
    const row = await store.publication(jobId);
    if (row?.publishedAt != null) await store.savePublication({ ...row, publishedAt: null, updatedAt: now() });
    return { ok: true as const };
  }

  /** The account's public and hidden creations, newest first: what its profile page marks. */
  async function mine(accountId: string): Promise<OwnPublication[]> {
    return (await store.publications(accountId)).map((r) => ({
      jobId: r.jobId,
      state: r.hiddenAt !== null ? "hidden" : "public",
      showPrompt: r.showPrompt,
      publishedAt: r.publishedAt,
      ...(r.hiddenAt !== null ? { reason: r.hiddenReason ?? "reports" } : {}),
    }));
  }

  /** A publication in the community right now: published, not hidden, and its profile not hidden either. */
  async function live(jobId: string): Promise<PublicationRow | undefined> {
    const row = UUID.test(jobId) ? await store.publication(jobId) : undefined;
    if (row?.publishedAt == null || row.hiddenAt !== null) return undefined;
    const owner = await store.profile(row.accountId);
    return owner && owner.hiddenAt === null ? row : undefined;
  }

  /** Whether the creation is in the community right now. */
  async function isPublic(jobId: string): Promise<boolean> {
    return Boolean(await live(jobId));
  }

  /**
   * Whether others may open this media file (`<jobId>/<file>`, as in /api/media/…): only the one result a public
   * creation shows. The media route asks this for files that are not the viewer's own.
   */
  async function isPublicMedia(path: string): Promise<boolean> {
    const row = await live(path.split("/")[0] ?? "");
    return row?.data.media.url === `/api/media/${path}`;
  }

  /**
   * A signed-in account reports a public creation (not its own). REPORTS_TO_HIDE distinct reports since the operator
   * last looked, or one about minors, take it out of the community until the operator restores it (unhide).
   */
  async function report(
    accountId: string,
    jobId: string,
    input: { reason?: unknown; note?: unknown },
  ): Promise<{ ok: true; first: boolean; hidden: boolean } | { ok: false; error: "invalid_reason" | "not_found" | "own_creation" }> {
    const reason = REPORT_REASONS.find((r) => r === input.reason);
    if (!reason) return { ok: false, error: "invalid_reason" };
    const row = await live(jobId);
    if (!row) return { ok: false, error: "not_found" };
    if (row.accountId === accountId) return { ok: false, error: "own_creation" };
    const at = now();
    const added = await store.addReport({ jobId, accountId, reason, note: line(input.note).slice(0, 500), at });
    const count = await store.reportCount(jobId, row.reviewedAt ?? 0);
    const hide = added && (HIDE_AT_ONCE.includes(reason) || count >= REPORTS_TO_HIDE);
    if (hide) await store.hide(jobId, at, "reports");
    // first: the operator hears of a creation once per review round, and again when reports hide it.
    return { ok: true, first: added && count === 1, hidden: hide };
  }

  /** Operator: looked at a reported creation and leaves it up; the reports so far count as settled. */
  async function dismiss(jobId: string) {
    const ok = UUID.test(jobId) && (await store.dismiss(jobId, now()));
    return ok ? { ok: true as const } : { ok: false as const, error: "not_found" as const };
  }

  /** A profile anyone may still see: it exists and the operator has not taken it out. */
  async function visibleProfile(handle: string) {
    const row = await store.profileByHandle(normalizeHandle(handle));
    return row && row.hiddenAt === null ? row : undefined;
  }

  /** A signed-in account reports someone else's profile (name, handle, bio, picture). The operator decides. */
  async function reportProfile(
    accountId: string,
    handle: string,
    input: { reason?: unknown; note?: unknown },
  ): Promise<{ ok: true; first: boolean } | { ok: false; error: "invalid_reason" | "not_found" | "self" }> {
    const reason = REPORT_REASONS.find((r) => r === input.reason);
    if (!reason) return { ok: false, error: "invalid_reason" };
    const row = await visibleProfile(handle);
    if (!row) return { ok: false, error: "not_found" };
    if (row.accountId === accountId) return { ok: false, error: "self" };
    const added = await store.addProfileReport({ accountId: row.accountId, reporterId: accountId, reason, note: line(input.note).slice(0, 500), at: now() });
    return { ok: true, first: added && (await store.profileReportCount(row.accountId, row.reviewedAt ?? 0)) === 1 };
  }

  /** Operator: takes a profile, its picture and all its creations out of the community; its owner sees `reason`. */
  async function hideProfile(handle: string, reason: string) {
    const row = await store.profileByHandle(normalizeHandle(handle));
    const ok = Boolean(row) && (await store.hideProfile(row!.accountId, now(), line(reason).slice(0, 300) || "reports"));
    return ok ? { ok: true as const } : { ok: false as const, error: "not_found" as const };
  }

  /** Operator: restores a hidden profile; the reports so far count as settled. */
  async function unhideProfile(handle: string) {
    const row = await store.profileByHandle(normalizeHandle(handle));
    const ok = Boolean(row) && (await store.unhideProfile(row!.accountId, now()));
    return ok ? { ok: true as const } : { ok: false as const, error: "not_found" as const };
  }

  /** Operator: looked at a reported profile and leaves it up. */
  async function dismissProfile(handle: string) {
    const row = await store.profileByHandle(normalizeHandle(handle));
    const ok = Boolean(row) && (await store.dismissProfile(row!.accountId, now()));
    return ok ? { ok: true as const } : { ok: false as const, error: "not_found" as const };
  }

  /** Operator: takes a creation out of the community; its owner sees `reason`. */
  async function hide(jobId: string, reason: string) {
    const ok = UUID.test(jobId) && (await store.hide(jobId, now(), line(reason).slice(0, 300) || "reports"));
    return ok ? { ok: true as const } : { ok: false as const, error: "not_found" as const };
  }

  /** Operator: restores a hidden creation; the reports so far count as settled. */
  async function unhide(jobId: string) {
    const ok = UUID.test(jobId) && (await store.unhide(jobId, now()));
    return ok ? { ok: true as const } : { ok: false as const, error: "not_found" as const };
  }

  async function page(q: FeedOptions, scope: { accountId?: string; viewer?: string; followedBy?: string } = {}): Promise<FeedPage> {
    const asked = typeof q.limit === "number" && Number.isFinite(q.limit) ? Math.floor(q.limit) : FEED_LIMIT;
    const limit = Math.min(Math.max(asked, 1), FEED_MAX);
    const sort: FeedSort = q.sort === "popular" ? "popular" : "new";
    const m = typeof q.before === "string" ? CURSOR.exec(q.before) : null;
    // A cursor of the other order reads from the top.
    const before = m && (sort === "popular") === (m[1] !== undefined)
      ? { ...(m[1] !== undefined ? { likes: Number(m[1]) } : {}), at: Number(m[2]), id: m[3]! }
      : undefined;
    const kind = kindOf(q.kind);
    const rows = await store.feed({
      limit: limit + 1, sort, ...(kind ? { kind } : {}), ...(scope.accountId ? { accountId: scope.accountId } : {}),
      ...(scope.viewer ? { viewer: scope.viewer } : {}), ...(scope.followedBy ? { followedBy: scope.followedBy } : {}), ...(before ? { before } : {}),
    });
    const shown = rows.slice(0, limit);
    const last = shown[shown.length - 1];
    return {
      items: shown.map((r) => ({
        ...r.data, id: r.jobId, kind: r.kind, publishedAt: r.publishedAt!, likes: r.likes,
        ...(scope.viewer ? { liked: Boolean(r.liked) } : {}),
        creator: { handle: r.handle, name: r.name, avatar: avatarUrl(r.handle, r.avatar, r.profileUpdatedAt) },
      })),
      next: rows.length > limit && last ? `${sort === "popular" ? `${last.likes}.` : ""}${last.publishedAt}_${last.jobId}` : null,
    };
  }

  /**
   * Public creations of everyone, newest first (or `sort: "popular"`, most liked first); `next` continues the list
   * (`before`). With a `viewer`, every creation says whether that account likes it.
   */
  async function feed(q: FeedOptions = {}, viewer?: string): Promise<FeedPage> {
    // “Following” needs someone who follows.
    if (q.following === true && !viewer) return { items: [], next: null };
    return page(q, { ...(viewer ? { viewer } : {}), ...(q.following === true && viewer ? { followedBy: viewer } : {}) });
  }

  /** Likes a public creation of someone else; once per account. */
  async function like(accountId: string, jobId: string): Promise<{ ok: true; liked: true; likes: number } | { ok: false; error: "not_found" | "own_creation" }> {
    const row = await live(jobId);
    if (!row) return { ok: false, error: "not_found" };
    if (row.accountId === accountId) return { ok: false, error: "own_creation" };
    return { ok: true, liked: true, likes: await store.like(jobId, accountId, now()) };
  }

  /** Takes a like back; idempotent. */
  async function unlike(accountId: string, jobId: string): Promise<{ ok: true; liked: false; likes: number } | { ok: false; error: "not_found" }> {
    const row = UUID.test(jobId) ? await store.publication(jobId) : undefined;
    if (!row) return { ok: false, error: "not_found" };
    return { ok: true, liked: false, likes: await store.unlike(jobId, accountId) };
  }

  /**
   * A creator's page: the public part of the profile, how many creations are public, followers and followed accounts
   * (counts only), and those creations. With a `viewer`: whether the viewer follows them, and what the viewer likes.
   */
  async function creator(
    handle: string,
    q: FeedOptions = {},
    viewer?: string,
  ): Promise<({ profile: PublicProfile; counts: Record<Kind, number>; followers: number; following: number; followed?: boolean } & FeedPage) | null> {
    const row = await visibleProfile(handle);
    if (!row) return null;
    const [counts, follows, followed, list] = await Promise.all([
      store.counts(row.accountId),
      store.followCounts(row.accountId),
      viewer ? store.isFollowing(viewer, row.accountId) : Promise.resolve(undefined),
      page(q, { accountId: row.accountId, ...(viewer ? { viewer } : {}) }),
    ]);
    const { showPrompts: _own, hidden: _never, ...profile } = toProfile(row);
    return { profile, counts, ...follows, ...(followed === undefined ? {} : { followed }), ...list };
  }

  /** Follows a creator by handle; not yourself. */
  async function follow(accountId: string, handle: string): Promise<{ ok: true; following: true; followers: number } | { ok: false; error: "not_found" | "self" }> {
    const row = await visibleProfile(handle);
    if (!row) return { ok: false, error: "not_found" };
    if (row.accountId === accountId) return { ok: false, error: "self" };
    await store.follow(accountId, row.accountId, now());
    return { ok: true, following: true, followers: (await store.followCounts(row.accountId)).followers };
  }

  /** Stops following; idempotent. */
  async function unfollow(accountId: string, handle: string): Promise<{ ok: true; following: false; followers: number } | { ok: false; error: "not_found" }> {
    const row = await store.profileByHandle(normalizeHandle(handle));
    if (!row) return { ok: false, error: "not_found" };
    await store.unfollow(accountId, row.accountId);
    return { ok: true, following: false, followers: (await store.followCounts(row.accountId)).followers };
  }

  /** The stored file of a profile's picture (a media key, as /api/media/<key>), or null without one. */
  async function avatarFile(handle: string): Promise<string | null> {
    const row = await visibleProfile(handle);
    return row?.avatar ? row.avatar.replace(/^\/api\/media\//, "") : null;
  }

  /** The owner's own numbers: followers, followed accounts, likes on their public creations. */
  async function stats(accountId: string): Promise<{ followers: number; following: number; likes: number }> {
    const [follows, likes] = await Promise.all([store.followCounts(accountId), store.likesReceived(accountId)]);
    return { ...follows, likes };
  }

  /** Operator: what waits, hidden first, then the most reported. Never who reported. */
  async function queue(): Promise<{ creations: QueueCreation[]; profiles: QueueProfile[] }> {
    const rows = await store.queue();
    const order = <T extends { hiddenAt: number | null; reports: QueueReport[] }>(a: T, b: T) =>
      (b.hiddenAt ?? 0) - (a.hiddenAt ?? 0) || b.reports.length - a.reports.length || (b.reports[0]?.at ?? 0) - (a.reports[0]?.at ?? 0);
    return {
      creations: [...rows.creations].sort(order).map((r) => ({
        jobId: r.jobId, handle: r.handle, kind: r.kind, media: r.data.media,
        state: r.hiddenAt !== null ? "hidden" : r.publishedAt !== null ? "public" : "private",
        ...(r.hiddenAt !== null ? { reason: r.hiddenReason ?? "reports" } : {}),
        reports: r.reports,
      })),
      profiles: [...rows.profiles].sort(order).map((r) => ({
        handle: r.handle, name: r.name, avatar: r.avatar,
        state: r.hiddenAt !== null ? "hidden" : "visible",
        ...(r.hiddenAt !== null ? { reason: r.hiddenReason ?? "reports" } : {}),
        reports: r.reports,
      })),
    };
  }

  /** The owner deletes their community profile; their creations stay theirs, privately (DSG: delete what is public). */
  async function deleteProfile(accountId: string) {
    await store.deleteProfile(accountId);
    return { ok: true as const };
  }

  /** For the deletion of an account: nothing of it stays in the community. */
  async function forgetAccount(accountId: string) {
    await store.forget(accountId);
    return { ok: true as const };
  }

  return {
    profile, saveProfile, publish, unpublish, mine, isPublic, isPublicMedia, feed, creator, report, hide, unhide, avatarFile, like, unlike, follow, unfollow,
    dismiss, reportProfile, hideProfile, unhideProfile, dismissProfile, stats, queue, deleteProfile, forgetAccount,
  };
}

export function createMemoryCommunityStore(): CommunityStore {
  const profiles = new Map<string, ProfileRow>();
  const publications = new Map<string, PublicationRow>();
  const reports = new Map<string, ReportRow>();
  const likes = new Map<string, number>();
  /** “follower|followee” → when. */
  const follows = new Map<string, number>();
  const profileReports = new Map<string, ProfileReportRow>();
  const visible = (p: PublicationRow) => p.publishedAt !== null && p.hiddenAt === null && profiles.get(p.accountId)?.hiddenAt === null;
  const byLikes = (a: PublicationRow, b: PublicationRow) => b.likes - a.likes || newestFirst(a, b);
  const at = (p: PublicationRow) => p.publishedAt ?? p.updatedAt;
  const newestFirst = (a: PublicationRow, b: PublicationRow) => at(b) - at(a) || (a.jobId < b.jobId ? 1 : a.jobId > b.jobId ? -1 : 0);
  const mark = (jobId: string, change: Partial<PublicationRow>) => {
    const p = publications.get(jobId);
    if (p) publications.set(jobId, { ...p, ...change });
    return Boolean(p);
  };
  const markProfile = (accountId: string, change: Partial<ProfileRow>) => {
    const p = profiles.get(accountId);
    if (p) profiles.set(accountId, { ...p, ...change });
    return Boolean(p);
  };
  return {
    async profile(accountId) {
      const p = profiles.get(accountId);
      return p && { ...p };
    },
    async profileByHandle(handle) {
      const p = [...profiles.values()].find((x) => x.handle === handle);
      return p && { ...p };
    },
    async saveProfile(row) {
      if ([...profiles.values()].some((p) => p.handle === row.handle && p.accountId !== row.accountId)) return "handle_taken";
      const prev = profiles.get(row.accountId);
      profiles.set(row.accountId, { ...row, hiddenAt: prev?.hiddenAt ?? null, hiddenReason: prev?.hiddenReason ?? null, reviewedAt: prev?.reviewedAt ?? null });
      return "ok";
    },
    async publication(jobId) {
      const p = publications.get(jobId);
      return p && structuredClone(p);
    },
    async savePublication(row) {
      const prev = publications.get(row.jobId);
      publications.set(row.jobId, {
        ...structuredClone(row), hiddenAt: prev?.hiddenAt ?? null, hiddenReason: prev?.hiddenReason ?? null, reviewedAt: prev?.reviewedAt ?? null,
        likes: prev?.likes ?? 0,
      });
    },
    async publications(accountId) {
      return [...publications.values()]
        .filter((p) => p.accountId === accountId && (p.publishedAt !== null || p.hiddenAt !== null))
        .sort(newestFirst)
        .map((p) => structuredClone(p));
    },
    async feed(q) {
      const { before } = q;
      const popular = q.sort === "popular";
      // The position of a creation in the order, compared like the database compares the row (likes, at, id).
      const after = (p: PublicationRow) => {
        if (!before) return true;
        if (popular && p.likes !== (before.likes ?? 0)) return p.likes < (before.likes ?? 0);
        return p.publishedAt! < before.at || (p.publishedAt === before.at && p.jobId < before.id);
      };
      return [...publications.values()]
        .filter((p) => visible(p) && (!q.kind || p.kind === q.kind) && (!q.accountId || p.accountId === q.accountId))
        .filter((p) => !q.followedBy || follows.has(`${q.followedBy}|${p.accountId}`))
        .filter(after)
        .sort(popular ? byLikes : newestFirst)
        .slice(0, q.limit)
        .map((p) => {
          const pr = profiles.get(p.accountId)!;
          return {
            ...structuredClone(p), handle: pr.handle, name: pr.name, avatar: pr.avatar, profileUpdatedAt: pr.updatedAt,
            ...(q.viewer ? { liked: likes.has(`${p.jobId}|${q.viewer}`) } : {}),
          };
        });
    },
    async counts(accountId) {
      const counts: Record<Kind, number> = { image: 0, video: 0 };
      for (const p of publications.values()) if (p.accountId === accountId && visible(p)) counts[p.kind] += 1;
      return counts;
    },
    async hide(jobId, when, reason) {
      return mark(jobId, { hiddenAt: when, hiddenReason: reason, updatedAt: when });
    },
    async unhide(jobId, when) {
      return mark(jobId, { hiddenAt: null, hiddenReason: null, reviewedAt: when, updatedAt: when });
    },
    async addReport(r) {
      const key = `${r.jobId}|${r.accountId}`;
      if (reports.has(key)) return false;
      reports.set(key, { ...r });
      return true;
    },
    async reportCount(jobId, since) {
      return [...reports.values()].filter((r) => r.jobId === jobId && r.at > since).length;
    },
    async like(jobId, accountId, at) {
      const key = `${jobId}|${accountId}`;
      const p = publications.get(jobId);
      if (p && !likes.has(key)) {
        likes.set(key, at);
        p.likes += 1;
      }
      return p?.likes ?? 0;
    },
    async unlike(jobId, accountId) {
      const p = publications.get(jobId);
      if (p && likes.delete(`${jobId}|${accountId}`)) p.likes = Math.max(0, p.likes - 1);
      return p?.likes ?? 0;
    },
    async follow(followerId, followeeId, at) {
      const key = `${followerId}|${followeeId}`;
      if (followerId !== followeeId && !follows.has(key)) follows.set(key, at);
    },
    async unfollow(followerId, followeeId) {
      follows.delete(`${followerId}|${followeeId}`);
    },
    async followCounts(accountId) {
      let followers = 0;
      let following = 0;
      for (const key of follows.keys()) {
        const [from, to] = key.split("|");
        if (to === accountId) followers += 1;
        if (from === accountId) following += 1;
      }
      return { followers, following };
    },
    async isFollowing(followerId, followeeId) {
      return follows.has(`${followerId}|${followeeId}`);
    },
    async dismiss(jobId, when) {
      return mark(jobId, { reviewedAt: when, updatedAt: when });
    },
    async hideProfile(accountId, when, reason) {
      return markProfile(accountId, { hiddenAt: when, hiddenReason: reason });
    },
    async unhideProfile(accountId, when) {
      return markProfile(accountId, { hiddenAt: null, hiddenReason: null, reviewedAt: when });
    },
    async dismissProfile(accountId, when) {
      return markProfile(accountId, { reviewedAt: when });
    },
    async addProfileReport(r) {
      const key = `${r.accountId}|${r.reporterId}`;
      if (profileReports.has(key)) return false;
      profileReports.set(key, { ...r });
      return true;
    },
    async profileReportCount(accountId, since) {
      return [...profileReports.values()].filter((r) => r.accountId === accountId && r.at > since).length;
    },
    async likesReceived(accountId) {
      let n = 0;
      for (const p of publications.values()) if (p.accountId === accountId && p.publishedAt !== null && p.hiddenAt === null) n += p.likes;
      return n;
    },
    async queue() {
      const open = <R extends { at: number; reason: ReportReason; note: string }>(list: R[], since: number | null) =>
        list.filter((r) => r.at > (since ?? 0)).sort((a, b) => b.at - a.at).map(({ reason, note, at }) => ({ reason, note, at }));
      const creations = [...publications.values()]
        .map((p) => ({ ...structuredClone(p), handle: profiles.get(p.accountId)?.handle ?? null, reports: open([...reports.values()].filter((r) => r.jobId === p.jobId), p.reviewedAt) }))
        .filter((p) => p.hiddenAt !== null || p.reports.length > 0);
      const waiting = [...profiles.values()]
        .map((p) => ({ ...p, reports: open([...profileReports.values()].filter((r) => r.accountId === p.accountId), p.reviewedAt) }))
        .filter((p) => p.hiddenAt !== null || p.reports.length > 0);
      return { creations, profiles: waiting };
    },
    async deleteProfile(accountId) {
      for (const [id, p] of [...publications]) {
        if (p.accountId !== accountId || p.hiddenAt !== null) continue;
        publications.delete(id);
        for (const k of [...likes.keys()]) if (k.startsWith(`${id}|`)) likes.delete(k);
        for (const k of [...reports.keys()]) if (k.startsWith(`${id}|`)) reports.delete(k);
      }
      for (const k of [...follows.keys()]) if (k.endsWith(`|${accountId}`)) follows.delete(k);
      for (const [k, r] of [...profileReports]) if (r.accountId === accountId) profileReports.delete(k);
      profiles.delete(accountId);
    },
    async forget(accountId) {
      for (const k of [...likes.keys()]) {
        const [jobId, who] = k.split("|");
        if (who !== accountId) continue;
        likes.delete(k);
        const p = publications.get(jobId!);
        if (p) p.likes = Math.max(0, p.likes - 1);
      }
      for (const [id, p] of [...publications]) {
        if (p.accountId !== accountId) continue;
        publications.delete(id);
        for (const k of [...likes.keys()]) if (k.startsWith(`${id}|`)) likes.delete(k);
        for (const k of [...reports.keys()]) if (k.startsWith(`${id}|`)) reports.delete(k);
      }
      for (const [k, r] of [...reports]) if (r.accountId === accountId) reports.delete(k);
      for (const [k, r] of [...profileReports]) if (r.accountId === accountId || r.reporterId === accountId) profileReports.delete(k);
      for (const k of [...follows.keys()]) {
        const [from, to] = k.split("|");
        if (from === accountId || to === accountId) follows.delete(k);
      }
      profiles.delete(accountId);
    },
  };
}

const ms = (v: Date | string | null) => (v === null ? null : new Date(v).getTime());

export function createPostgresCommunityStore(db: Db): CommunityStore {
  type PRow = {
    account_id: string; handle: string; name: string; bio: string; show_prompts: boolean; terms_at: Date; created_at: Date; updated_at: Date;
    avatar: string | null; hidden_at: Date | null; hidden_reason: string | null; reviewed_at: Date | null;
  };
  type PubRow = {
    job_id: string; account_id: string; kind: Kind; show_prompt: boolean; data: CreationData; published_at: Date | null; updated_at: Date;
    hidden_at: Date | null; hidden_reason: string | null; reviewed_at: Date | null; likes: number;
  };
  type FRow = PubRow & { handle: string; name: string; profile_avatar: string | null; profile_updated_at: Date; liked: boolean | null };
  const toPublication = (r: PubRow): PublicationRow => ({
    jobId: r.job_id, accountId: r.account_id, kind: r.kind, showPrompt: r.show_prompt, data: r.data, publishedAt: ms(r.published_at), updatedAt: ms(r.updated_at)!,
    hiddenAt: ms(r.hidden_at), hiddenReason: r.hidden_reason, reviewedAt: ms(r.reviewed_at), likes: r.likes,
  });
  const toRow = (r: PRow): ProfileRow => ({
    accountId: r.account_id, handle: r.handle, name: r.name, bio: r.bio, showPrompts: r.show_prompts,
    termsAt: ms(r.terms_at)!, createdAt: ms(r.created_at)!, updatedAt: ms(r.updated_at)!, avatar: r.avatar,
    hiddenAt: ms(r.hidden_at), hiddenReason: r.hidden_reason, reviewedAt: ms(r.reviewed_at),
  });
  return {
    async profile(accountId) {
      const [r] = await db.query<PRow>("select * from profiles where account_id = $1", [accountId]);
      return r && toRow(r);
    },
    async profileByHandle(handle) {
      const [r] = await db.query<PRow>("select * from profiles where handle = $1", [handle]);
      return r && toRow(r);
    },
    async saveProfile(p) {
      try {
        await db.query(
          `insert into profiles (account_id, handle, name, bio, show_prompts, terms_at, created_at, updated_at, avatar)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (account_id) do update set handle = excluded.handle, name = excluded.name, bio = excluded.bio,
             show_prompts = excluded.show_prompts, updated_at = excluded.updated_at, avatar = excluded.avatar`,
          [p.accountId, p.handle, p.name, p.bio, p.showPrompts, new Date(p.termsAt), new Date(p.createdAt), new Date(p.updatedAt), p.avatar],
        );
        return "ok";
      } catch (e) {
        // The only unique key left after “on conflict (account_id)” is the handle.
        if ((e as { code?: string }).code === "23505") return "handle_taken";
        throw e;
      }
    },
    async publication(jobId) {
      const [r] = await db.query<PubRow>("select * from publications where job_id = $1", [jobId]);
      return r && toPublication(r);
    },
    async savePublication(p) {
      await db.query(
        `insert into publications (job_id, account_id, kind, show_prompt, data, published_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (job_id) do update set kind = excluded.kind, show_prompt = excluded.show_prompt, data = excluded.data,
           published_at = excluded.published_at, updated_at = excluded.updated_at`,
        [p.jobId, p.accountId, p.kind, p.showPrompt, JSON.stringify(p.data), p.publishedAt === null ? null : new Date(p.publishedAt), new Date(p.updatedAt)],
      );
    },
    async publications(accountId) {
      const rows = await db.query<PubRow>(
        `select * from publications where account_id = $1 and (published_at is not null or hidden_at is not null)
         order by coalesce(published_at, updated_at) desc, job_id desc`,
        [accountId],
      );
      return rows.map(toPublication);
    },
    async feed(q) {
      // Only the conditions this query needs, each value a parameter.
      const params: unknown[] = [];
      const arg = (v: unknown, type: string) => {
        params.push(v);
        return `$${params.length}::${type}`;
      };
      const popular = q.sort === "popular";
      const where = ["p.published_at is not null", "p.hidden_at is null", "pr.hidden_at is null"];
      if (q.kind) where.push(`p.kind = ${arg(q.kind, "text")}`);
      if (q.accountId) where.push(`p.account_id = ${arg(q.accountId, "uuid")}`);
      if (q.followedBy) where.push(`p.account_id in (select followee_id from follows where follower_id = ${arg(q.followedBy, "uuid")})`);
      if (q.before) {
        const at = arg(new Date(q.before.at), "timestamptz");
        const id = arg(q.before.id, "uuid");
        where.push(popular ? `(p.likes, p.published_at, p.job_id) < (${arg(q.before.likes ?? 0, "int")}, ${at}, ${id})` : `(p.published_at, p.job_id) < (${at}, ${id})`);
      }
      const liked = q.viewer ? `exists (select 1 from publication_likes l where l.job_id = p.job_id and l.account_id = ${arg(q.viewer, "uuid")})` : "null::boolean";
      const rows = await db.query<FRow>(
        `select p.*, pr.handle, pr.name, pr.avatar as profile_avatar, pr.updated_at as profile_updated_at, ${liked} as liked
         from publications p join profiles pr on pr.account_id = p.account_id
         where ${where.join(" and ")}
         order by ${popular ? "p.likes desc, " : ""}p.published_at desc, p.job_id desc
         limit ${arg(q.limit, "int")}`,
        params,
      );
      return rows.map((r) => ({
        ...toPublication(r), handle: r.handle, name: r.name, avatar: r.profile_avatar, profileUpdatedAt: ms(r.profile_updated_at)!,
        ...(r.liked === null ? {} : { liked: r.liked }),
      }));
    },
    async counts(accountId) {
      const rows = await db.query<{ kind: Kind; n: number }>(
        `select p.kind, count(*)::int as n from publications p join profiles pr on pr.account_id = p.account_id
         where p.account_id = $1 and p.published_at is not null and p.hidden_at is null and pr.hidden_at is null group by p.kind`,
        [accountId],
      );
      const counts: Record<Kind, number> = { image: 0, video: 0 };
      for (const r of rows) counts[r.kind] = r.n;
      return counts;
    },
    async hide(jobId, at, reason) {
      const rows = await db.query("update publications set hidden_at = $2, hidden_reason = $3, updated_at = $2 where job_id = $1 returning job_id", [
        jobId, new Date(at), reason,
      ]);
      return rows.length > 0;
    },
    async unhide(jobId, at) {
      const rows = await db.query(
        "update publications set hidden_at = null, hidden_reason = null, reviewed_at = $2, updated_at = $2 where job_id = $1 returning job_id",
        [jobId, new Date(at)],
      );
      return rows.length > 0;
    },
    async addReport(r) {
      const rows = await db.query(
        `insert into publication_reports (job_id, account_id, reason, note, created_at) values ($1, $2, $3, $4, $5)
         on conflict (job_id, account_id) do nothing returning job_id`,
        [r.jobId, r.accountId, r.reason, r.note, new Date(r.at)],
      );
      return rows.length > 0;
    },
    async reportCount(jobId, since) {
      const [r] = await db.query<{ n: number }>("select count(*)::int as n from publication_reports where job_id = $1 and created_at > $2", [
        jobId, new Date(since),
      ]);
      return r?.n ?? 0;
    },
    async like(jobId, accountId, at) {
      // The like and the counter in one statement: two likes at once never lose a count.
      const [r] = await db.query<{ likes: number }>(
        `with added as (
           insert into publication_likes (job_id, account_id, created_at) values ($1, $2, $3) on conflict do nothing returning 1
         )
         update publications set likes = likes + (select count(*) from added)::int where job_id = $1 returning likes`,
        [jobId, accountId, new Date(at)],
      );
      return r?.likes ?? 0;
    },
    async unlike(jobId, accountId) {
      const [r] = await db.query<{ likes: number }>(
        `with removed as (delete from publication_likes where job_id = $1 and account_id = $2 returning 1)
         update publications set likes = greatest(likes - (select count(*) from removed)::int, 0) where job_id = $1 returning likes`,
        [jobId, accountId],
      );
      return r?.likes ?? 0;
    },
    async follow(followerId, followeeId, at) {
      if (followerId === followeeId) return;
      await db.query("insert into follows (follower_id, followee_id, created_at) values ($1, $2, $3) on conflict do nothing", [followerId, followeeId, new Date(at)]);
    },
    async unfollow(followerId, followeeId) {
      await db.query("delete from follows where follower_id = $1 and followee_id = $2", [followerId, followeeId]);
    },
    async followCounts(accountId) {
      const [r] = await db.query<{ followers: number; following: number }>(
        `select (select count(*) from follows where followee_id = $1)::int as followers,
                (select count(*) from follows where follower_id = $1)::int as following`,
        [accountId],
      );
      return { followers: r?.followers ?? 0, following: r?.following ?? 0 };
    },
    async isFollowing(followerId, followeeId) {
      const rows = await db.query("select 1 from follows where follower_id = $1 and followee_id = $2", [followerId, followeeId]);
      return rows.length > 0;
    },
    async dismiss(jobId, at) {
      const rows = await db.query("update publications set reviewed_at = $2, updated_at = $2 where job_id = $1 returning job_id", [jobId, new Date(at)]);
      return rows.length > 0;
    },
    async hideProfile(accountId, at, reason) {
      const rows = await db.query("update profiles set hidden_at = $2, hidden_reason = $3 where account_id = $1 returning account_id", [accountId, new Date(at), reason]);
      return rows.length > 0;
    },
    async unhideProfile(accountId, at) {
      const rows = await db.query(
        "update profiles set hidden_at = null, hidden_reason = null, reviewed_at = $2 where account_id = $1 returning account_id",
        [accountId, new Date(at)],
      );
      return rows.length > 0;
    },
    async dismissProfile(accountId, at) {
      const rows = await db.query("update profiles set reviewed_at = $2 where account_id = $1 returning account_id", [accountId, new Date(at)]);
      return rows.length > 0;
    },
    async addProfileReport(r) {
      const rows = await db.query(
        `insert into profile_reports (account_id, reporter_id, reason, note, created_at) values ($1, $2, $3, $4, $5)
         on conflict (account_id, reporter_id) do nothing returning account_id`,
        [r.accountId, r.reporterId, r.reason, r.note, new Date(r.at)],
      );
      return rows.length > 0;
    },
    async profileReportCount(accountId, since) {
      const [r] = await db.query<{ n: number }>("select count(*)::int as n from profile_reports where account_id = $1 and created_at > $2", [
        accountId, new Date(since),
      ]);
      return r?.n ?? 0;
    },
    async likesReceived(accountId) {
      const [r] = await db.query<{ n: number }>(
        "select coalesce(sum(likes), 0)::int as n from publications where account_id = $1 and published_at is not null and hidden_at is null",
        [accountId],
      );
      return r?.n ?? 0;
    },
    async queue() {
      type Open = { reports: { reason: ReportReason; note: string; at: string }[] };
      const reportsOf = (r: Open) => r.reports.map((x) => ({ reason: x.reason, note: x.note, at: new Date(x.at).getTime() }));
      const creations = await db.query<PubRow & Open & { owner_handle: string | null }>(
        `select p.*, pr.handle as owner_handle,
           coalesce((select json_agg(json_build_object('reason', r.reason, 'note', r.note, 'at', r.created_at) order by r.created_at desc)
                     from publication_reports r where r.job_id = p.job_id and r.created_at > coalesce(p.reviewed_at, 'epoch')), '[]'::json) as reports
         from publications p left join profiles pr on pr.account_id = p.account_id
         where p.hidden_at is not null
            or exists (select 1 from publication_reports r where r.job_id = p.job_id and r.created_at > coalesce(p.reviewed_at, 'epoch'))
         limit 500`,
      );
      const waiting = await db.query<PRow & Open>(
        `select pr.*,
           coalesce((select json_agg(json_build_object('reason', r.reason, 'note', r.note, 'at', r.created_at) order by r.created_at desc)
                     from profile_reports r where r.account_id = pr.account_id and r.created_at > coalesce(pr.reviewed_at, 'epoch')), '[]'::json) as reports
         from profiles pr
         where pr.hidden_at is not null
            or exists (select 1 from profile_reports r where r.account_id = pr.account_id and r.created_at > coalesce(pr.reviewed_at, 'epoch'))
         limit 500`,
      );
      return {
        creations: creations.map((r) => ({ ...toPublication(r), handle: r.owner_handle, reports: reportsOf(r) })),
        profiles: waiting.map((r) => ({ ...toRow(r), reports: reportsOf(r) })),
      };
    },
    async deleteProfile(accountId) {
      await db.tx(async (q) => {
        const shared = "select job_id from publications where account_id = $1 and hidden_at is null";
        await q(`delete from publication_likes where job_id in (${shared})`, [accountId]);
        await q(`delete from publication_reports where job_id in (${shared})`, [accountId]);
        await q("delete from publications where account_id = $1 and hidden_at is null", [accountId]);
        await q("delete from follows where followee_id = $1", [accountId]);
        await q("delete from profile_reports where account_id = $1", [accountId]);
        await q("delete from profiles where account_id = $1", [accountId]);
      });
    },
    async forget(accountId) {
      await db.tx(async (q) => {
        const own = "select job_id from publications where account_id = $1";
        // The likes this account gave leave their counters first.
        await q("update publications p set likes = greatest(p.likes - 1, 0) from publication_likes l where l.job_id = p.job_id and l.account_id = $1", [accountId]);
        await q(`delete from publication_likes where account_id = $1 or job_id in (${own})`, [accountId]);
        await q(`delete from publication_reports where account_id = $1 or job_id in (${own})`, [accountId]);
        await q("delete from profile_reports where account_id = $1 or reporter_id = $1", [accountId]);
        await q("delete from follows where follower_id = $1 or followee_id = $1", [accountId]);
        await q("delete from publications where account_id = $1", [accountId]);
        await q("delete from profiles where account_id = $1", [accountId]);
      });
    },
  };
}
