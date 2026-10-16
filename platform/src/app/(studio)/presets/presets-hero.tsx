"use client";

import { useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { counter, nextIndex, prevIndex } from "@/components/studio/active-item";
import { XpLink } from "@/components/studio/editorial-ui";
import { LoopVideo } from "@/components/studio/loop-video";
import { PreviewButton, usePreview } from "@/components/studio/media-preview";
import { PosterLetters } from "@/components/studio/poster-letters";
import { twoLines } from "@/components/studio/poster-type";
import { CATEGORY_LABEL, type PresetInfo } from "@/components/studio/presets-data";
import { presetEntry } from "@/components/studio/preview";
import { useInView } from "@/components/studio/use-in-view";
import { PresetPrice } from "./preset-price";

const SLIDE_MS = 8000;

/**
 * The page opens on its presets, one per full-bleed slide: the name as giant split type, the tagline and the
 * real clip as a portrait card on its own blurred poster (full-bleed on a phone). Runs only while on screen and not
 * hovered; arrows and swipes step. Only the active slide mounts its clip.
 */
export function PresetsHero({ presets }: { presets: PresetInfo[] }) {
  const preview = usePreview();
  const [ref, onScreen] = useInView<HTMLElement>({ once: false, rootMargin: "0px" });
  const [cur, setCur] = useState(0);
  const [held, setHeld] = useState(false);
  const swipe = useRef<number | null>(null);
  const n = presets.length;
  const at = n ? Math.min(cur, n - 1) : 0;
  const p = presets[at];
  const go = (i: number) => setCur(i);

  return (
    <section
      ref={ref}
      className={`ps-hero theme-dark${onScreen ? " is-seen" : ""}`}
      aria-roledescription="carousel"
      aria-label="Presets"
      tabIndex={-1}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(nextIndex(at, n));
        if (e.key === "ArrowLeft") go(prevIndex(at, n));
      }}
      onPointerDown={(e) => (swipe.current = e.clientX)}
      onPointerUp={(e) => {
        if (swipe.current === null) return;
        const dx = e.clientX - swipe.current;
        swipe.current = null;
        if (Math.abs(dx) > 60) go(dx < 0 ? nextIndex(at, n) : prevIndex(at, n));
      }}
    >
      <h1 className="ps-sr">Presets</h1>
      {presets.map((x, i) => {
        const on = i === at;
        const [l1, l2] = twoLines(x.tagline);
        return (
          <article key={x.id} className={`ps-hero__slide${on ? " is-on" : ""}`} aria-roledescription="slide" aria-label={`${i + 1} of ${n}: ${x.title}, ${x.tagline}`} aria-hidden={!on}>
            <div className="ps-hero__bg" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={x.preview.poster} alt="" loading={i === 0 ? "eager" : "lazy"} decoding="async" />
            </div>
            <PosterLetters title={x.title} className="ps-hero__letters" />
            <p className="ps-hero__stamp" aria-hidden="true">
              {l1}
              {l2 && <br />}
              {l2}
            </p>
            <div className="ps-hero__card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="ps-hero__poster" src={x.preview.poster} alt="" loading={i === 0 ? "eager" : "lazy"} decoding="async" />
              {on && <LoopVideo className="ps-hero__clip" src={x.preview.video} poster={x.preview.poster} />}
              <PreviewButton onOpen={() => preview.openEntries(presets.map(presetEntry), i)} />
            </div>
          </article>
        );
      })}

      <div className="xp-bar ps-hero__bar">
        <div className="xp-bar__side">
          <span className="xp-muted">Presets</span>
          <a href="#all" className="xp-bar__link">All presets <ArrowDown aria-hidden="true" /></a>
        </div>
        {n > 1 ? (
          <div className="xp-dots" role="tablist" aria-label="Choose a preset">
            <span className="xp-dots__count" aria-hidden="true">{counter(at, n)}</span>
            {presets.map((x, i) => (
              <button key={x.id} type="button" role="tab" aria-selected={i === at} aria-label={x.title} className={`xp-dot${i === at ? " is-on" : ""}`} onClick={() => go(i)}>
                <span
                  style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: held || !onScreen ? "paused" : "running" }}
                  onAnimationEnd={() => go(nextIndex(at, n))}
                />
              </button>
            ))}
          </div>
        ) : (
          <span aria-hidden="true" />
        )}
        <div className="xp-bar__side xp-bar__side--end">
          {p && (
            <>
              <span className="xp-muted">{CATEGORY_LABEL[p.category]}</span>
              <strong className="xp-bar__name">{p.title}</strong>
              <PresetPrice credits={p.credits} className="ps-hero__price" />
              <XpLink href={`/presets/${p.id}`} className="xp-btn--solid">Try it</XpLink>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
