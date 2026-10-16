/**
 * Marketing Agent in the browser: the shapes the API returns, the views and their URLs, and the pure helpers of the
 * page (template filter, justified rows, a job's run settings). No React here, so it is tested on its own.
 */

export type Kind = "image" | "video";
export type Need = "required" | "optional" | "none";
export type Category = { id: string; label: string; kind: Kind };
export type Style = {
  id: string; category: string; flow: string; kind: Kind; title: string; group: string | null;
  aspect: string; aspects: string[]; batch: boolean; duration: { min: number; max: number; default: number; steps?: number[] } | null;
  product: Need; avatar: Need; adReference: boolean;
  wishHint: string | null; badge: "neu" | "top" | null; available: boolean; lettering: boolean; spoken: boolean; chain: boolean;
  cover: string | null; base: string | null; coverShape: string; credits: number | null;
};
export type Overview = { categories: Category[]; styles: Style[]; templates: Style[] };

/** A creative of the agent's campaign plan (core/marketing-agent.ts). */
export type Creative = {
  type: "marketing"; styleId: string; title: string; category: string; kind: Kind; cover: string | null;
  wish?: string; aspect: string; duration?: number; caption?: string; why: string; needs: ("product" | "avatar")[];
  lettering: boolean; spoken: boolean; credits: number | null;
};

export type Product = { id: string; name: string; description: string; images: string[]; source?: string; pick: number };
/** A saved ad reference: an own upload whose layout, palette and mood a run takes over. */
export type AdRef = { id: string; url: string; name: string };
/** UGC runs in two steps; the browser starts step 2 when the still is done (the server makes it idempotent). */
export type Chain = { frameJobId: string; styleId: string; wish: string; duration: number; aspect: string; credits: number; videoJobId?: string; error?: string; projectId?: string };

export const VIEWS = ["home", "agent", "generations", "favorites", "products", "references", "projects", "project"] as const;
export type View = (typeof VIEWS)[number];

/** `?view=` of the page; anything unknown is the start page. */
export function parseView(v: string | null | undefined): View {
  return (VIEWS as readonly string[]).includes(v ?? "") ? (v as View) : "home";
}

/**
 * The page URL for a view and a selection, so every view has a link and the back button works. `template` opens that
 * template's dialog (“Recreate”) on top of the view.
 */
export function viewHref(view: View, extra: { category?: string | null; style?: string | null; template?: string | null; project?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (view !== "home") q.set("view", view);
  if (extra.project) q.set("project", extra.project);
  if (extra.category) q.set("category", extra.category);
  if (extra.style) q.set("style", extra.style);
  if (extra.template) q.set("template", extra.template);
  const s = q.toString();
  return s ? `/marketing?${s}` : "/marketing";
}

const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `?template=` of the page: the template whose dialog is open, or null. */
export function parseTemplate(v: string | null | undefined): string | null {
  return v && TEMPLATE_ID.test(v) ? v : null;
}

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `?project=` of the page: the open project, or null. */
export function parseProject(v: string | null | undefined): string | null {
  return v && PROJECT_ID.test(v) ? v : null;
}

/** A project gathers generations like a folder (stored in the account's library, kind “project”). */
export type Project = { id: string; name: string; jobIds: string[]; pinned: boolean; createdAt: number };
export type ProjectSort = "active" | "name" | "created";
const PROJECT_JOBS = 500;

/** New generations go first, each once; a project keeps its newest 500. */
export function withJobs(p: Project, ids: string[]): Project {
  return { ...p, jobIds: [...new Set([...ids, ...p.jobIds])].slice(0, PROJECT_JOBS) };
}
export function withoutJob(p: Project, id: string): Project {
  return { ...p, jobIds: p.jobIds.filter((x) => x !== id) };
}

/** Pinned first, then by last activity (newest generation), name or creation. */
export function sortProjects(list: Project[], by: ProjectSort, lastActive: (p: Project) => number): Project[] {
  const key = (a: Project, b: Project) =>
    by === "name" ? a.name.localeCompare(b.name, "en", { sensitivity: "base" })
      : by === "created" ? b.createdAt - a.createdAt
      : lastActive(b) - lastActive(a);
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || key(a, b));
}

export function searchProjects(list: Project[], q: string): Project[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return words.length ? list.filter((p) => words.every((w) => fold(p.name).includes(w))) : list;
}

/** “Project 5” after “Project 4”: the next free number. */
export function nextProjectName(list: Project[]): string {
  const n = Math.max(0, ...list.map((p) => Number(/^Project (\d+)$/.exec(p.name)?.[1] ?? 0)));
  return `Project ${n + 1}`;
}

export type WishRole = "spoken" | "lettering" | "describe" | "wish";

/**
 * What a run's text means for a style: the sentence a person says (UGC), lettering in the image, a description the
 * style needs because there is no product photo (poster, motion), or an optional wish for the scene.
 */
export function wishField(style: Style, hasProduct: boolean): { role: WishRole; required: boolean; placeholder: string; max: number } {
  if (style.spoken) {
    return { role: "spoken", required: true, placeholder: `What the avatar says, e.g. ${style.wishHint?.replace(/^e\.g\. /, "") ?? "I use this every day"}`, max: 160 };
  }
  const describe = (style.flow === "poster" || style.flow === "motion") && !hasProduct;
  if (style.lettering) return { role: "lettering", required: describe, placeholder: `Short and strong, ${style.wishHint ?? "e.g. Fresher than ever"}`, max: 200 };
  if (describe) return { role: "describe", required: true, placeholder: "What is the product? e.g. Organic ginger lemonade in a glass bottle", max: 200 };
  return { role: "wish", required: false, placeholder: style.kind === "video" ? "Optional: mood, motion, details …" : "Optional: light, colours, details …", max: 200 };
}

/** “More like this” in a template's dialog: other templates of its category, the ones that run today first. */
export function moreTemplates(templates: Style[], current: Style, n: number): Style[] {
  const same = templates.filter((t) => t.category === current.category && t.id !== current.id);
  return [...same.filter((t) => t.available), ...same.filter((t) => !t.available)].slice(0, n);
}

export const ratioOf = (a: string) => {
  const [w = 1, h = 1] = a.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 1;
};

/** What a Marketing Agent job was started with, from its tag (`recipe.id = "ms:<style>"`, `recipe.inputs`). */
export type Run = {
  styleId: string; wish?: string; product?: string; avatar?: string; adReference?: string; aspect?: string; duration?: number; count?: number;
};

const OWN_UPLOAD = /^\/api\/media\/uploads\//;

export function runOf(params: Record<string, unknown>): Run | null {
  const r = params.recipe as { id?: unknown; wish?: unknown; inputs?: unknown } | undefined;
  if (!r || typeof r.id !== "string" || !r.id.startsWith("ms:")) return null;
  const inputs = (r.inputs && typeof r.inputs === "object" ? r.inputs : {}) as Record<string, unknown>;
  const file = (k: string) => (typeof inputs[k] === "string" && OWN_UPLOAD.test(inputs[k] as string) ? { [k]: inputs[k] as string } : {});
  const num = (k: string) => (typeof inputs[k] === "number" && Number.isInteger(inputs[k]) ? { [k]: inputs[k] as number } : {});
  return {
    styleId: r.id.slice(3),
    ...(typeof r.wish === "string" && r.wish ? { wish: r.wish } : {}),
    ...file("product"), ...file("avatar"), ...file("adReference"),
    ...(typeof inputs.aspect === "string" ? { aspect: inputs.aspect } : {}),
    ...num("duration"), ...num("count"),
  };
}

/** Whether a run can be repeated as is: the style still runs and every file it needs is known. */
export function repeatable(run: Run, style: Style | undefined): boolean {
  if (!style?.available) return false;
  if (style.product === "required" && !run.product) return false;
  if (style.avatar === "required" && !run.avatar) return false;
  if (style.spoken && !run.wish) return false;
  if ((style.flow === "poster" || style.flow === "motion") && !run.product && !run.wish) return false;
  return true;
}

/** The body of POST /api/marketing for a run (files only where the style takes them). */
export function startBody(run: Run, style: Style, opts: { count?: number; consent?: boolean; maxCredits?: number | null }) {
  return {
    styleId: style.id,
    ...(run.product && style.product !== "none" ? { product: run.product } : {}),
    ...(run.avatar && style.avatar !== "none" ? { avatar: run.avatar, consent: opts.consent === true } : {}),
    ...(run.adReference && style.adReference ? { adReference: run.adReference } : {}),
    ...(run.wish ? { wish: run.wish } : {}),
    ...(run.aspect && style.aspects.includes(run.aspect) ? { aspect: run.aspect } : {}),
    ...(run.duration !== undefined && style.duration ? { duration: run.duration } : {}),
    count: style.batch ? Math.min(4, Math.max(1, opts.count ?? 1)) : 1,
    ...(opts.maxCredits !== undefined && opts.maxCredits !== null ? { maxCredits: opts.maxCredits } : {}),
  };
}

/** The body of POST /api/marketing/quote for a run: files by presence only. */
export function quoteBody(run: Run, style: Style) {
  return {
    styleId: style.id,
    product: Boolean(run.product) || style.product === "required",
    avatar: Boolean(run.avatar) && style.avatar !== "none",
    adReference: Boolean(run.adReference) && style.adReference,
    ...(run.aspect && style.aspects.includes(run.aspect) ? { aspect: run.aspect } : {}),
    ...(run.duration !== undefined && style.duration ? { duration: run.duration } : {}),
  };
}

/** “My generations”: by media type, failed runs hidden on request (running ones always stay). */
export function filterResults<J extends { status: string }>(jobs: J[], f: { media: "all" | Kind; hideFailed: boolean }, isVideo: (j: J) => boolean): J[] {
  return jobs.filter((j) => (f.media === "all" || (f.media === "video") === isVideo(j)) && !(f.hideFailed && j.status === "failed"));
}

export type TemplateFilter = { category: string; media: "all" | Kind; q: string };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Templates for the wall: by category, media type and a search over title, style and group.
 * `styles` resolves a template's base style for the search.
 */
export function filterTemplates(templates: Style[], styles: Style[], f: TemplateFilter): Style[] {
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  return templates.filter((t) => {
    if (f.category !== "all" && t.category !== f.category) return false;
    if (f.media !== "all" && t.kind !== f.media) return false;
    if (!words.length) return true;
    const base = styles.find((s) => s.id === t.base);
    const hay = fold(`${t.title} ${base?.title ?? ""} ${t.group ?? ""}`);
    return words.every((w) => hay.includes(w));
  });
}

/** The brief as the agent reads it: one short message from the form. */
export function briefText(b: { goal: string | null; channels: string[]; audience: string; offer: string; tone: string | null; language: string }): string {
  return [
    b.goal ? `Goal: ${b.goal}` : "",
    b.channels.length ? `Channels: ${b.channels.join(", ")}` : "",
    b.audience.trim() ? `Audience: ${b.audience.trim()}` : "",
    b.offer.trim() ? `Offer and message: ${b.offer.trim()}` : "",
    b.tone ? `Tone: ${b.tone}` : "",
    `Language of the texts: ${b.language}`,
  ].filter(Boolean).join("\n");
}
