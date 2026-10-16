"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { columnsFor, distribute } from "./wall-layout";
import "./wall.css";

/**
 * The walls (image and video studio, Explore, community): the page name sideways along the wall, columns of the one
 * tile (Shot). Layout maths in wall-layout.ts, styles in wall.css.
 */

/** Columns that fit the wall (at least `min` px each), measured before the first paint and again on every resize. */
function useColumns(ref: React.RefObject<HTMLDivElement | null>, min: number, dense: boolean) {
  const [cols, setCols] = useState(3);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCols(dense ? columnsFor(el.clientWidth, min, DENSE_GAP, DENSE_MAX) : columnsFor(el.clientWidth, min));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min, dense]);
  return cols;
}

/**
 * Marks the wall for its reveal and each tile (`data-tile`) once it scrolls into view (`data-in`), with one observer
 * for all tiles, also those added later. Without script or with reduced motion nothing is hidden.
 */
function useReveal(ref: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.dataset.reveal = "";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px" },
    );
    const watch = () => root.querySelectorAll<HTMLElement>("[data-tile]:not([data-in])").forEach((el) => io.observe(el));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [ref]);
}

/** The dense wall (image studio, built like Midjourney's): thin gaps, up to four columns, no stagger. Gap as in wall.css. */
const DENSE_GAP = 4;
const DENSE_MAX = 4;

/**
 * Tiles in staggered columns (or `dense`: flush and tight): every second column starts lower (CSS), each tile goes to the column holding least
 * (wall-layout.ts), so the numbers run along the rows. `ratio`: a tile's height / width before its media has loaded;
 * `min`: the least column width. Tiles fade up as they scroll into view.
 */
export function Columns<T>({ items, ratio, keyOf, min = 330, dense = false, children }: { items: T[]; ratio: (t: T) => number; keyOf: (t: T) => string; min?: number; dense?: boolean; children: (t: T, i: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const cols = useColumns(ref, min, dense);
  useReveal(ref);
  const columns = useMemo(() => distribute(items.map(ratio), cols, dense ? { gap: 0.01 } : undefined), [items, ratio, cols, dense]);
  return (
    <div ref={ref} className={`wall-cols${dense ? " wall-cols--dense" : ""}`} style={{ "--cols": cols } as React.CSSProperties}>
      {columns.map((col, c) => (
        <div key={c} className="wall-col">
          {col.map((i) => (
            <div key={keyOf(items[i]!)} className="wall-tile" data-tile style={{ "--c": c } as React.CSSProperties}>
              {children(items[i]!, i)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The page's name, sideways along the wall (across the top on phones): the first word in ink, the second muted. Key it by view to replay its entrance. */
export function WallTitle({ words }: { words: [string, string] }) {
  return (
    <div className="wall-rail">
      <h1 className="wall-title" aria-label={words.join(" ")}>
        {words.map((w, i) => (
          <span key={w} className={`wall-title__w${i ? " wall-title__w--muted" : ""}`} aria-hidden="true">
            <span style={{ "--i": i } as React.CSSProperties}>{w}</span>
          </span>
        ))}
      </h1>
    </div>
  );
}

/**
 * The one tile of every wall (image and video studio, Explore, community): only the picture at rest, plus a small
 * `badge` top left where the kind matters (a clip, a preset). Hover or keyboard focus shows its `facts` as one quiet
 * mark at the foot ("Mode · Format 3:4"), no shade; a click opens it large in the shared preview. Marks use the
 * result cards' chip (`.card__chip`, studio.css), so own results and examples read alike. Actions (like, report,
 * the creator's page) live in the preview, never on the tile.
 */
export function Shot({ media, title, facts, badge, onOpen }: { media: React.ReactNode; title: string; facts?: string[]; badge?: React.ReactNode; onOpen: () => void }) {
  return (
    <article className="wall-shot">
      <button type="button" className="wall-shot__hit" onClick={onOpen} aria-label={`${title}: view large`}>
        {media}
      </button>
      {badge && <span className="card__chips" aria-hidden="true"><span className="card__chip">{badge}</span></span>}
      {facts && facts.length > 0 && <span className="wall-shot__facts" aria-hidden="true"><span className="card__chip">{facts.join(" · ")}</span></span>}
    </article>
  );
}
