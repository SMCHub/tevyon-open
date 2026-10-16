"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { LoopVideo } from "@/components/studio/loop-video";
import { PreviewButton, usePreview } from "@/components/studio/media-preview";
import { PosterLetters } from "@/components/studio/poster-letters";
import { twoLines } from "@/components/studio/poster-type";
import { CATEGORY_LABEL, type PresetInfo } from "@/components/studio/presets-data";
import { presetEntry } from "@/components/studio/preview";
import { PresetPrice } from "./preset-price";
import { categoryFilters, type CategoryFilter } from "./presets-order";

type View = "list" | "grid";
/** How far each list row steps in (vw), so the names stagger like a poster index. */
const NUDGE = [0, 7, 15, 4, 11, 19, 2, 9];

const no = (i: number) => String(i + 1).padStart(2, "0");

/** Two lines of italics for a poster or the trailing card. */
function Stamp({ text, className }: { text: string; className: string }) {
  const [a, b] = twoLines(text);
  return (
    <span className={className} aria-hidden="true">
      {a}
      {b && <br />}
      {b}
    </span>
  );
}

/**
 * Every preset, as a numbered list of giant names (on a desktop the clip trails the pointer, the name inverts over it) or
 * as a grid of posters. Filter tags by category and a toggle between the two views.
 */
export function PresetsIndex({ presets }: { presets: PresetInfo[] }) {
  const preview = usePreview();
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<CategoryFilter["id"]>("all");
  const [hot, setHot] = useState<number | null>(null);
  // The preset on the trailing card: set by the pointer only (a keyboard focus lights the row, no card), and kept while
  // the card fades out.
  const [floatId, setFloatId] = useState<string | null>(null);
  const float = useRef<HTMLDivElement>(null);
  const filters = categoryFilters(presets);
  const shown = presets.filter((p) => filter === "all" || p.category === filter);
  const open = (i: number) => preview.openEntries(shown.map(presetEntry), i);

  // The card trails the pointer with a little lag (only where there is a pointer that hovers).
  useEffect(() => {
    if (view !== "list" || !window.matchMedia("(hover: hover)").matches) return;
    let x = window.innerWidth / 2, y = window.innerHeight / 2, px = x, py = y, raf = 0;
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
    };
    const tick = () => {
      px += (x - px) * 0.16;
      py += (y - py) * 0.16;
      if (float.current) float.current.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", move, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  }, [view]);

  const hp = hot !== null ? shown[hot] : undefined;
  const fp = shown.find((p) => p.id === floatId);
  const floatOn = !!hp && hp.id === floatId;

  return (
    <section className="ps-index" id="all" aria-labelledby="ps-index-title" data-view={view}>
      <div className="ps-index__head">
        <h2 className="ps-index__title" id="ps-index-title">
          All presets <span className="xp-muted">{presets.length ? String(presets.length).padStart(2, "0") : "–"}</span>
        </h2>
        {filters.length > 2 && (
          <div className="chips" role="tablist" aria-label="Category">
            {filters.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`chip${filter === f.id ? " is-on" : ""}`} onClick={() => setFilter(f.id)}>
                {f.label} <span className="ps-count">{f.count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ps-index__tools">
          <div className="ps-toggle" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={view === "list"} className={`chip${view === "list" ? " is-on" : ""}`} onClick={() => setView("list")}>
              <span className="ps-toggle__icon ps-toggle__icon--list" aria-hidden="true"><i /><i /><i /></span>List
            </button>
            <button type="button" role="radio" aria-checked={view === "grid"} className={`chip${view === "grid" ? " is-on" : ""}`} onClick={() => setView("grid")}>
              <span className="ps-toggle__icon ps-toggle__icon--grid" aria-hidden="true"><i /><i /><i /><i /></span>Grid
            </button>
          </div>
        </div>
      </div>

      {view === "list" ? (
        <ol className={`ps-list${hot !== null ? " has-hot" : ""}`} onMouseLeave={() => setHot(null)}>
          {shown.map((p, i) => {
            return (
              <li
                key={p.id}
                className={`ps-row${hot === i ? " is-hot" : ""}`}
                style={{ "--nudge": `${NUDGE[i % NUDGE.length]}vw`, "--len": [...p.title].length } as React.CSSProperties}
                onMouseEnter={() => {
                  setHot(i);
                  setFloatId(p.id);
                }}
              >
                <Link
                  href={`/presets/${p.id}`}
                  className="ps-row__link"
                  onFocus={() => {
                    setHot(i);
                    setFloatId(null);
                  }}
                  onBlur={() => setHot(null)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="ps-row__thumb" src={p.preview.poster} alt="" loading="lazy" decoding="async" />
                  <span className="ps-row__no" aria-hidden="true">{no(i)}</span>
                  <span className="ps-row__name">{p.title}</span>
                  <span className="ps-row__meta">
                    <span className="ps-row__tag">{p.tagline}</span>
                    <span className="xp-muted">{CATEGORY_LABEL[p.category]}</span>
                    <PresetPrice credits={p.credits} />
                  </span>
                </Link>
                <PreviewButton onOpen={() => open(i)} />
              </li>
            );
          })}
        </ol>
      ) : (
        <ul className="ps-grid">
          {shown.map((p, i) => {
            return (
              <li key={p.id} className="ps-poster">
                <Link href={`/presets/${p.id}`} className="ps-poster__link" aria-label={`${p.title}: ${p.tagline}`}>
                  <LoopVideo className="ps-poster__media" src={p.preview.video} poster={p.preview.poster} />
                  <span className="ps-poster__shade" aria-hidden="true" />
                  <PosterLetters title={p.title} className="ps-poster__letters" />
                  <Stamp text={p.tagline} className="ps-poster__stamp" />
                  <span className="ps-poster__foot">
                    <span className="ps-poster__no">{no(i)} · {CATEGORY_LABEL[p.category]}</span>
                    {p.badge && <span className="ps-poster__badge">{p.badge === "top" ? "Top" : "New"}</span>}
                    <PresetPrice credits={p.credits} />
                    <span className="ps-poster__go" aria-hidden="true"><ArrowUpRight /></span>
                  </span>
                </Link>
                <PreviewButton onOpen={() => open(i)} />
              </li>
            );
          })}
        </ul>
      )}

      {/* The trailing card: the pointed-at preset's clip; its name inverts over it (difference blend). The clip only
          runs while the card shows, the poster stays for the fade. */}
      {view === "list" && (
        <div className={`ps-float${floatOn ? " is-on" : ""}`} ref={float} aria-hidden="true">
          {fp && (
            <div className="ps-float__card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="ps-float__clip" src={fp.preview.poster} alt="" decoding="async" />
              {floatOn && <LoopVideo key={fp.id} className="ps-float__clip" src={fp.preview.video} poster={fp.preview.poster} />}
              <Stamp text={fp.tagline} className="ps-float__stamp" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
