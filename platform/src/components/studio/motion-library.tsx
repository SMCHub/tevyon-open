"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Copy, Orbit, Replace, Sparkles, TrendingUp } from "lucide-react";
import type { LibraryCategory, LibraryPreset } from "@/core/motion-library";
import { LoopVideo } from "./loop-video";
import { PreviewButton, usePreview } from "./media-preview";
import type { PreviewEntry } from "./preview";

const TABS: { id: LibraryCategory; label: string; icon: React.ReactNode }[] = [
  { id: "curated", label: "Curated", icon: <Sparkles aria-hidden="true" /> },
  { id: "trending", label: "Trending", icon: <TrendingUp aria-hidden="true" /> },
  { id: "new", label: "New", icon: <Clock3 aria-hidden="true" /> },
];

export const MODE_LABEL: Record<LibraryPreset["mode"], string> = { motion: "Transfer motion", replace: "Replace object" };
export const MODE_ICON: Record<LibraryPreset["mode"], React.ReactNode> = { motion: <Orbit aria-hidden="true" />, replace: <Replace aria-hidden="true" /> };

/** The recast presets as a wall of looping results; "Recreate" hands the chosen one to the panel. */
export function MotionLibrary({ onRecreate, busyId, selectedId = null }: { onRecreate: (p: LibraryPreset) => void; busyId: string | null; selectedId?: string | null }) {
  const [presets, setPresets] = useState<LibraryPreset[] | null>(null);
  const [tab, setTab] = useState<LibraryCategory>("trending");
  useEffect(() => {
    fetch("/api/motion-library")
      .then((r) => (r.ok ? r.json() : { presets: [] }))
      .then((d: { presets: LibraryPreset[] }) => setPresets(d.presets))
      .catch(() => setPresets([]));
  }, []);
  const shown = useMemo(
    () => (presets ?? []).filter((p) => p.categories[tab] !== undefined).sort((a, b) => a.categories[tab]! - b.categories[tab]!),
    [presets, tab],
  );
  // In the preview a template plays large (with its sound, if it has any); "Recreate" there does what the card's button does.
  const preview = usePreview();
  const entryOf = (p: LibraryPreset): PreviewEntry => ({
    url: p.media.preview,
    kind: "video",
    poster: p.media.poster,
    chip: MODE_LABEL[p.mode],
    title: p.title,
    text: p.description,
    facts: [`${p.seconds} s`, p.resolution, ...(p.images ? [p.images === 1 ? "1 image" : `${p.images} images`] : [])],
    action: selectedId === p.id ? { label: "Applied", disabled: true } : { label: "Recreate", run: () => onRecreate(p), disabled: busyId !== null },
  });

  return (
    <div className="mlib">
      <div className="mlib__tabs" role="tablist" aria-label="Motion Library">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="mlib__tab" onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {presets === null ? (
        <p className="note">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="empty">
          <Orbit aria-hidden="true" />
          <p>{(presets ?? []).length === 0
            ? "Templates are coming soon. Until then: upload your own video on the left, add images, done."
            : "There are no templates in this section yet."}</p>
        </div>
      ) : (
        <div className="mlib__wall">
          {shown.map((p, i) => (
            <figure key={p.id} className={`mlib__card${selectedId === p.id ? " is-picked" : ""}`}>
              <LoopVideo className="mlib__media" src={p.media.preview} poster={p.media.poster} style={{ aspectRatio: `${p.width} / ${p.height}` }} />
              <span className="mlib__badge">{MODE_ICON[p.mode]} {MODE_LABEL[p.mode]}</span>
              <PreviewButton onOpen={() => preview.openEntries(shown.map(entryOf), i)} />
              <figcaption className="mlib__foot">
                <span className="mlib__title">{p.title}</span>
                <button type="button" className="mlib__go" onClick={() => onRecreate(p)} disabled={busyId !== null}>
                  {busyId === p.id ? <span className="ring" aria-hidden="true" /> : selectedId === p.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {selectedId === p.id ? "Applied" : "Recreate"}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
