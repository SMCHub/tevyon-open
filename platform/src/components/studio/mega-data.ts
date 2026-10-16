/**
 * What the header's mega menus show and where they open, without React, so it is tested on its own. Models come from
 * the register (/api/catalog), prices from /api/prices; only the tools are written down here (a new model shows up
 * in the menu by itself).
 */
export type Kind = "image" | "video";
export type Menu = Kind;
export type Badge = "neu" | "top";
/** A way into the studio. */
export type MenuTool = { title: string; desc: string; href: string; badge?: Badge };
type Entry = { jobType: string; kind: Kind; model: string; tagline: string; badge: Badge | null; family?: string; status?: "active" | "deprecated" | "paused" };
export type MenuFamily<E> = { key: string; name: string; maker: string | null; models: E[] };

/** Tools that work today, each a real link. What is not built yet stays in SOON, compact and honest. */
const TOOLS: Record<Kind, MenuTool[]> = {
  image: [
    { title: "Bild erstellen", desc: "Aus Text in Sekunden, Preis vor dem Start", href: "/image", badge: "top" },
    { title: "Director", desc: "Idee im Gespräch entwickeln, er schreibt die Prompts", href: "/director" },
    { title: "Bild → Video", desc: "Dein Bild als Startbild für einen Clip", href: "/video?mode=image" },
    { title: "Meine Bilder", desc: "Alle Ergebnisse, erneut verwenden", href: "/assets" },
  ],
  video: [
    { title: "Video erstellen", desc: "Aus einem Satz ein Clip, mit Ton", href: "/video", badge: "top" },
    { title: "Bild → Video", desc: "Ein Standbild in Bewegung setzen", href: "/video?mode=image" },
    { title: "Director", desc: "Szene planen, Entwurf und Final in einem Gespräch", href: "/director" },
  ],
};

/** Not built yet: named, never linked. */
export const SOON: Record<Kind, string[]> = {
  image: ["Relight", "Inpaint"],
  video: [],
};

const ORDER: Menu[] = ["image", "video"];

/** The fixed tools of a menu. */
export function kindTools(kind: Kind): MenuTool[] {
  return TOOLS[kind];
}

/** «ByteDance · fotorealistisch, 4K» → maker and description; a tagline without « · » has no maker. */
export function splitTagline(tagline: string): { maker: string | null; text: string } {
  const at = tagline.indexOf(" · ");
  return at < 0 ? { maker: null, text: tagline } : { maker: tagline.slice(0, at).trim(), text: tagline.slice(at + 3).trim() };
}

const TIER_WORD = /^(pro|max|lite|flash|fast|mini|klein|flare|turbo|plus|ultra)$/i;
/**
 * A family's display name: the leading words of its first model up to the version or tier («GPT Image 2.5» →
 * «GPT Image», «Nano Banana Pro» → «Nano Banana»), else the first word without its version («FLUX.2 Pro» → «FLUX»).
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
    if (c.kind !== kind || seen.has(c.model)) continue;
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
 * The price a model starts at, in credits (Swiss thousands); «ab» when other settings make it cheaper than the default.
 * `short` leaves the unit to a column head.
 */
export function priceText(price: { from: number; standard: number } | undefined, opts: { short?: boolean } = {}): string | null {
  if (!price) return null;
  const n = (v: number) => v.toLocaleString("de-CH");
  const text = price.from < price.standard ? `ab ${n(price.from)}` : n(price.standard);
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
