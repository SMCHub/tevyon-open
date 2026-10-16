"use client";

import { useEffect, useRef } from "react";

// At most this many clips decode at once; the rest show their poster (without one, their first frame) and play nothing.
const MAX_PLAYING = 3;

/** still: no poster, so a visible clip that waits loads its first frame (metadata only). */
type Entry = { v: HTMLVideoElement; src: string; ratio: number; still: boolean };
const entries = new Map<HTMLVideoElement, Entry>();
let scheduled = false;
let held = 0;

/** Pauses every clip while the media preview is open (only the preview plays, with sound); call the result to resume. */
export function holdLoops(): () => void {
  held++;
  rebalance();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    held--;
    rebalance();
  };
}

/** Plays the MAX_PLAYING most visible clips, pauses every other one. */
function rebalance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const ranked = held ? [] : [...entries.values()].filter((e) => e.ratio > 0).sort((a, b) => b.ratio - a.ratio);
    const winners = new Set(ranked.slice(0, MAX_PLAYING).map((e) => e.v));
    for (const e of entries.values()) {
      if (winners.has(e.v)) {
        if (!e.v.src) e.v.src = e.src;
        e.v.play().catch(() => {});
      } else {
        if (!e.v.paused) e.v.pause();
        // Without a poster a waiting clip would be an empty box: its frame at 0.1 s stands in (the community wall).
        if (e.still && !held && e.ratio > 0 && !e.v.src) {
          e.v.preload = "metadata";
          e.v.src = `${e.src}#t=0.1`;
        }
      }
    }
  });
}

/**
 * Muted looping clip that only loads and plays while it is among the most visible on screen.
 * A wall of thirty tiles decodes three, the others keep their poster. With reduced motion the poster stays.
 */
export function LoopVideo({ src, poster, className, style, onRatio }: { src: string; poster?: string; className?: string; style?: React.CSSProperties; eager?: boolean; onRatio?: (r: number) => void }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // No poster to fall back on: show the first frame, still.
      if (!poster) {
        v.preload = "metadata";
        v.src = src;
      }
      return;
    }
    const entry: Entry = { v, src, ratio: 0, still: !poster };
    entries.set(v, entry);
    const io = new IntersectionObserver(
      ([e]) => {
        entry.ratio = e!.isIntersecting ? e!.intersectionRatio : 0;
        rebalance();
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    io.observe(v);
    return () => {
      io.disconnect();
      entries.delete(v);
      rebalance();
    };
  }, [src, poster]);

  return <video ref={ref} className={className} style={style} poster={poster} muted loop playsInline preload="none" aria-hidden="true" onLoadedMetadata={(e) => onRatio?.(e.currentTarget.videoWidth / e.currentTarget.videoHeight)} />;
}
