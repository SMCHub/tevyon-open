"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { ArrowDown, Dices } from "lucide-react";
import { Lines, XpLink } from "@/components/studio/editorial-ui";
import { usePresets } from "@/components/studio/presets-data";
import { useInView } from "@/components/studio/use-in-view";
import { PresetsHero } from "./presets-hero";
import { PresetsIndex } from "./presets-index";
import { featuredPresets, pickSurprise } from "./presets-order";
import "@/components/studio/editorial.css";
import "./presets.css";

/** Between the slides and the list: what a preset does, in three lines, after the brand site's intro. */
function PresetsIntro({ onSurprise }: { onSurprise: () => void }) {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section ref={ref} className={`ps-intro${inView ? " is-in" : ""}`} aria-labelledby="ps-intro-title">
      <h2 className="ps-intro__title" id="ps-intro-title">
        <span className="ps-intro__word ps-intro__word--muted"><Lines lines={["One photo."]} /></span>
        <span className="ps-intro__word"><Lines lines={["One click."]} /></span>
        <span className="ps-intro__word ps-intro__word--serif"><Lines lines={["done."]} /></span>
      </h2>
      <div className="ps-intro__body">
        <p className="ps-intro__text">
          <Lines lines={["Pick a preset and upload your photo.", "Model, camera and prompt are already set.", "The price is fixed before you start."]} />
        </p>
        <div className="ps-intro__cta">
          <button type="button" className="xp-pill" onClick={onSurprise}>
            <Dices aria-hidden="true" /> Surprise me
          </button>
          <a href="#all" className="xp-bar__link">All presets <ArrowDown aria-hidden="true" /></a>
        </div>
      </div>
    </section>
  );
}

/** The last word: a missing effect goes to the Director. */
function PresetsEnd() {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section ref={ref} className={`ps-end${inView ? " is-in" : ""}`} aria-labelledby="ps-end-title">
      <h2 className="ps-end__title" id="ps-end-title">
        <Lines lines={["Your effect"]} />
        <span className="ps-end__serif"><Lines lines={["is missing?"]} /></span>
      </h2>
      <p className="ps-end__lead">Describe it to the Director. It proposes shot, model and price; you start with one click.</p>
      <XpLink href="/director">Ask the Director</XpLink>
    </section>
  );
}

/**
 * Presets in the build of an editorial brand site (structure only, our own words and clips): full-bleed slides of the
 * presets, an intro in three lines, every preset as a list or a grid of posters, and a way to the Director.
 */
export function PresetsPage() {
  const router = useRouter();
  const presets = usePresets();
  const featured = useMemo(() => featuredPresets(presets), [presets]);
  const surprise = () => {
    const id = pickSurprise(presets);
    if (id) router.push(`/presets/${id}`);
  };
  return (
    <div className="studio xp ps">
      <PresetsHero presets={featured} />
      <PresetsIntro onSurprise={surprise} />
      <PresetsIndex presets={presets} />
      <PresetsEnd />
    </div>
  );
}
