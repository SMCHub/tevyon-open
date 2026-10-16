import { CATEGORY_LABEL, type PresetInfo } from "@/components/studio/presets-data";

const BADGE_RANK: Record<string, number> = { top: 0, neu: 1 };

/** The presets on the full-bleed slides: top ones first, then new ones, list order within. */
export function featuredPresets(presets: PresetInfo[]): PresetInfo[] {
  const rank = (p: PresetInfo) => (p.badge ? BADGE_RANK[p.badge] ?? 2 : 2);
  return presets.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(({ p }) => p);
}

/** "Surprise me": the id of a random preset, or null when there is none. */
export function pickSurprise(presets: PresetInfo[], random: () => number = Math.random): string | null {
  if (presets.length === 0) return null;
  return presets[Math.min(presets.length - 1, Math.floor(random() * presets.length))]!.id;
}

export type CategoryFilter = { id: "all" | PresetInfo["category"]; label: string; count: number };

/** The filter tags: "All" and every category that has presets, with counts, in the label order. */
export function categoryFilters(presets: PresetInfo[]): CategoryFilter[] {
  const cats = (Object.keys(CATEGORY_LABEL) as PresetInfo["category"][])
    .map((c) => ({ id: c, label: CATEGORY_LABEL[c], count: presets.filter((p) => p.category === c).length }))
    .filter((c) => c.count > 0);
  return [{ id: "all", label: "All", count: presets.length }, ...cats];
}
