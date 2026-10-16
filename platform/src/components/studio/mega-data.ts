/**
 * What the header's mega menus show and where they open, without React, so it is tested on its own. Models come from
 * the register (/api/catalog), prices from /api/prices; only the tools are written down here (a new model or preset
 * shows up in the menu by itself).
 */
export type Kind = "image" | "video";
export type Menu = Kind | "presets";
export type Badge = "neu" | "top";
/** A way into the studio. */
export type MenuTool = { title: string; desc: string; href: string; badge?: Badge };
type Entry = { jobType: string; kind: Kind; model: string; tagline: string; badge: Badge | null; family?: string; status?: "active" | "deprecated" | "paused" };
export type MenuFamily<E> = { key: string; name: string; maker: string | null; models: E[] };

/** Tools that work today, each a real link. What is not built yet stays in SOON, compact and honest. */
const TOOLS: Record<Kind, MenuTool[]> = {
  image: [
    { title: "Create image", desc: "From text in seconds, price before you start", href: "/image", badge: "top" },
    { title: "Director", desc: "Develop an idea in conversation, it writes the prompts", href: "/director" },
    { title: "Image → Video", desc: "Your image as the start frame of a clip", href: "/video?mode=image" },
    { title: "My images", desc: "All results, ready to reuse", href: "/assets" },
    { title: "Marketing Agent", desc: "Plan a campaign: product shots, ads, posters and shop images from one product photo", href: "/marketing", badge: "neu" },
  ],
  video: [
    { title: "Create video", desc: "A clip from one sentence, with sound", href: "/video", badge: "top" },
    { title: "Image → Video", desc: "Set a still image in motion", href: "/video?mode=image" },
    { title: "Presets", desc: "One photo, one finished clip, one click", href: "/presets" },
    { title: "Director", desc: "Plan a scene, draft and final in one conversation", href: "/director" },
    { title: "Marketing Agent", desc: "UGC clips and motion from one product photo", href: "/marketing?category=ugc", badge: "neu" },
  ],
};

/**
 * Job types in the register that are a tool built on a model: they join the tools with their name and badge from the
 * register (only while the register has them) and never stand in the model list.
 */
const TOOL_JOBS: Record<string, { href: string; desc: string }> = {
  cutout: { href: "/image/tools?tool=cutout", desc: "Remove the background, PNG with transparency" },
  upscale: { href: "/image/tools?tool=upscale", desc: "Sharper and larger, 2× or 4×" },
  relight: { href: "/image/tools?tool=relight", desc: "New light on a photo: time of day, direction" },
  replace_background: { href: "/image/tools?tool=background", desc: "Keep the subject, describe a new setting" },
  video_edit: { href: "/video/tools?tool=edit", desc: "Change, remove or replace something in your own video" },
  video_upscale: { href: "/video/tools?tool=upscale", desc: "Your video larger and sharper, up to 4K" },
};

/** Not built yet: named, never linked. */
export const SOON: Record<Kind, string[]> = {
  image: ["Relight", "Inpaint"],
  video: [],
};

const ORDER: Menu[] = ["image", "video", "presets"];

/** The fixed tools of a menu plus the register's tools of that kind that take jobs. */
export function kindTools(kind: Kind, catalog: Entry[]): MenuTool[] {
  const fromRegister = catalog
    .filter((c) => c.kind === kind && TOOL_JOBS[c.jobType] && c.status !== "paused")
    .map((c): MenuTool => {
      const t = TOOL_JOBS[c.jobType]!;
      return { title: c.model, desc: t.desc, href: t.href, ...(c.badge ? { badge: c.badge } : {}) };
    });
  return [...TOOLS[kind], ...fromRegister];
}

/** "ByteDance · photorealistic, 4K" → maker and description; a tagline without " · " has no maker. */
export function splitTagline(tagline: string): { maker: string | null; text: string } {
  const at = tagline.indexOf(" · ");
  return at < 0 ? { maker: null, text: tagline } : { maker: tagline.slice(0, at).trim(), text: tagline.slice(at + 3).trim() };
}

const TIER_WORD = /^(pro|max|lite|flash|fast|mini|klein|flare|turbo|plus|ultra)$/i;
/**
 * A family's display name: the leading words of its first model up to the version or tier ("GPT Image 2.5" →
 * "GPT Image", "Nano Banana Pro" → "Nano Banana"), else the first word without its version ("FLUX.2 Pro" → "FLUX").
 */
const familyName = (model: string) => {
  const words = model.trim().split(/\s+/);
  const end = words.findIndex((w) => /\d/.test(w) || TIER_WORD.test(w));
  const lead = words.slice(0, end < 0 ? words.length : end);
  return lead.length > 0 ? lead.join(" ") : (words[0] ?? model).split(".")[0] || model;
};

/**
 * The models of one kind grouped by family, in the order the register lists them, each name once. A family is named
 * after its first model and carries the maker its taglines share, so a new family needs no code here.
 */
export function menuFamilies<E extends Entry>(catalog: E[], kind: Kind): MenuFamily<E>[] {
  const seen = new Set<string>();
  const groups = new Map<string, E[]>();
  for (const c of catalog) {
    if (c.kind !== kind || TOOL_JOBS[c.jobType] || seen.has(c.model)) continue;
    seen.add(c.model);
    const key = c.family ?? familyName(c.model).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups].map(([key, models]) => {
    const makers = new Set(models.map((m) => splitTagline(m.tagline).maker));
    const maker = makers.size === 1 ? [...makers][0]! : null;
    return { key, name: familyName(models[0]!.model), maker, models };
  });
}

/**
 * The price a model starts at, in credits (US thousands separator); "from" when other settings make it cheaper than the default.
 * `short` leaves the unit to a column head.
 */
export function priceText(price: { from: number; standard: number } | undefined, opts: { short?: boolean } = {}): string | null {
  if (!price) return null;
  const n = (v: number) => v.toLocaleString("en-US");
  const text = price.from < price.standard ? `from ${n(price.from)}` : n(price.standard);
  return opts.short ? text : `${text} Credits`;
}

/** The giant type on the poster: the first word on its own line, the rest under it. */
export function posterLines(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? [words[0]!, words.slice(1).join(" ")] : words;
}

/** The poster's stamp in two lines: at the comma nearest the middle, else between words near the middle. */
export function stampLines(text: string): string[] {
  const t = text.trim();
  const commas = [...t.matchAll(/, /g)].map((m) => m.index!);
  if (commas.length) {
    const mid = t.length / 2;
    const at = commas.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best));
    return [t.slice(0, at + 1), t.slice(at + 2)];
  }
  const words = t.split(/\s+/);
  if (words.length < 2) return [t];
  let first = words[0]!;
  let i = 1;
  while (i < words.length - 1 && `${first} ${words[i]}`.length <= t.length / 2) first = `${first} ${words[i++]}`;
  return [first, words.slice(i).join(" ")];
}

/** Which way the content moves when the pointer goes from one menu to the next: +1 to the right, -1 to the left. */
export function menuStep(from: Menu | null, to: Menu): -1 | 0 | 1 {
  if (!from || from === to) return 0;
  return ORDER.indexOf(to) > ORDER.indexOf(from) ? 1 : -1;
}

export type Placement = { mode: "flush" | "float"; top: number; left: number; width: number };

/**
 * Where the panel opens, from the visible bar of the header. A full-width bar: flush under it, over the whole width,
 * so bar and menu read as one surface. A floating pill (scrolled): a card 8 px under it, as wide as the pill but wide
 * enough for three columns, centred under it and inside the screen.
 */
export function megaPlacement(bar: { left: number; width: number; bottom: number }, viewport: number): Placement {
  if (bar.width >= viewport * 0.92) return { mode: "flush", top: bar.bottom, left: bar.left, width: bar.width };
  const width = Math.min(Math.max(bar.width, 960), viewport - 24);
  const centred = bar.left + bar.width / 2 - width / 2;
  const left = Math.max(12, Math.min(centred, viewport - 12 - width));
  return { mode: "float", top: bar.bottom + 8, left, width };
}
