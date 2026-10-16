import { describe, expect, it } from "vitest";
import type { PresetInfo } from "@/components/studio/presets-data";
import { categoryFilters, featuredPresets, pickSurprise } from "./presets-order";

const preset = (id: string, over: Partial<PresetInfo> = {}): PresetInfo => ({
  id,
  title: id,
  tagline: "",
  category: "viral",
  needs: "photo",
  badge: null,
  preview: { video: `/presets/${id}.mp4`, poster: `/presets/${id}.webp` },
  wishHint: null,
  line: null,
  credits: 85,
  ...over,
});

describe("featuredPresets", () => {
  it("leads with top presets, then new ones, then the rest, in list order within each", () => {
    const list = [preset("a"), preset("b", { badge: "neu" }), preset("c", { badge: "top" }), preset("d"), preset("e", { badge: "top" })];
    expect(featuredPresets(list).map((p) => p.id)).toEqual(["c", "e", "b", "a", "d"]);
  });
});

describe("pickSurprise", () => {
  it("picks among the presets", () => {
    const list = [preset("a"), preset("b"), preset("c")];
    expect(pickSurprise(list, () => 0)).toBe("a");
    expect(pickSurprise(list, () => 0.99)).toBe("c");
  });

  it("has nothing to pick without a preset", () => {
    expect(pickSurprise([], () => 0.5)).toBeNull();
  });
});

describe("categoryFilters", () => {
  it("offers \"all\" and every category that has presets, with counts, in a fixed order", () => {
    const list = [preset("a", { category: "ads" }), preset("b"), preset("c", { category: "ads" })];
    expect(categoryFilters(list)).toEqual([
      { id: "all", label: "All", count: 3 },
      { id: "viral", label: "Viral", count: 1 },
      { id: "ads", label: "Ads", count: 2 },
    ]);
  });
});
