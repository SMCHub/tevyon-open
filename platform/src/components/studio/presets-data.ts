"use client";

import { useEffect, useState } from "react";

export type PresetInfo = {
  id: string;
  title: string;
  tagline: string;
  category: "effects" | "viral" | "ads";
  needs: "photo" | "product" | "place";
  badge: "neu" | "top" | null;
  preview: { video: string; poster: string };
  /** Placeholder of the optional wish field. */
  wishHint: string | null;
  /** Set when the wish is spoken in the clip: then it is required. */
  line: { label: string; placeholder: string } | null;
  credits: number | null;
};

export const CATEGORY_LABEL: Record<PresetInfo["category"], string> = { effects: "Effects", viral: "Viral", ads: "Ads" };

let cache: PresetInfo[] | null = null;

/** Preset list from /api/presets, cached for the session. */
export function usePresets() {
  const [presets, setPresets] = useState<PresetInfo[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    fetch("/api/presets").then((r) => r.json()).then((d: { presets: PresetInfo[] }) => {
      cache = d.presets;
      setPresets(d.presets);
    });
  }, []);
  return presets;
}
