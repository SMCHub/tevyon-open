"use client";

import "./text-model-picker.css";
import { Fragment } from "react";
import { Check, ChevronDown, Crown, Scale, Zap } from "lucide-react";
import { Popover } from "@/components/studio/popover";
import { TokenGlyph } from "@/components/studio/tachyon-token";

export type TextTier = "beste" | "ausgewogen" | "schnell";

/** A language model as GET /api/director/models lists it: no vendor ids, no prices, only a cost class and today's turns. */
export type TextModel = {
  id: string;
  name: string;
  maker: string;
  tier: TextTier;
  tagline: string;
  vision: boolean;
  default: boolean;
  /** 1 (cheapest) to 4: how fast a turn uses up today's Director budget. */
  cost: 1 | 2 | 3 | 4;
  /** The strongest models cost credits per message instead of the free budget. */
  paid: boolean;
  credits?: { typical: number; cap: number };
  allowed?: boolean;
  turnsLeft?: number;
  /** Why a paid model cannot be chosen: no purchase yet, or too few credits for its cap. */
  locked?: "purchase" | "credits";
};

/** The price line of a paid model: about what a message costs, and the most it can cost. */
export const priceLine = (m: TextModel) => (m.credits ? `≈ ${m.credits.typical} Credits, at most ${m.credits.cap}` : "");

export const TIER: Record<TextTier, { label: string; icon: React.ReactNode }> = {
  beste: { label: "Best", icon: <Crown /> },
  ausgewogen: { label: "Balanced", icon: <Scale /> },
  schnell: { label: "Fast", icon: <Zap /> },
};

function Cost({ n }: { n: number }) {
  return (
    <span className="tm-cost" role="img" aria-label={`Usage ${n} of 4`} title={`Uses up the daily allowance ${["very slowly", "slowly", "steadily", "quickly"][n - 1]}`}>
      {[1, 2, 3, 4].map((i) => <i key={i} className={i <= n ? "on" : undefined} />)}
    </span>
  );
}

const LOCKED: Record<NonNullable<TextModel["locked"]>, { short: string; title: string }> = {
  purchase: { short: "after first purchase", title: "The strongest models cost Credits per message and unlock with your first Credits purchase." },
  credits: { short: "not enough Credits", title: "Your balance is not enough for a message with this model right now." },
};

/**
 * The list opens on the chosen model: only the list scrolls, never the page. A stable function, so React calls it
 * once when the list mounts and not again on every render while it is open (job polling re-renders the page).
 */
function scrollToChosen(list: HTMLDivElement | null) {
  if (!list) return;
  // After the popover has capped its height to the room it found (same frame, before paint).
  requestAnimationFrame(() => {
    const on = list.querySelector<HTMLElement>(".tm-item.is-on");
    if (on && on.offsetTop + on.offsetHeight > list.clientHeight) list.scrollTop = on.offsetTop - list.clientHeight / 2 + on.offsetHeight / 2;
  });
}

/** The Director's language model, chosen in the composer like the image model in the image studio. */
export function TextModelPicker({
  models, model, share, paying, owed = 0, onChoose,
}: { models: TextModel[]; model: TextModel; share: number | null; paying: boolean; owed?: number; onChoose: (id: string) => void }) {
  return (
    <Popover
      label="Choose language model"
      side="auto"
      panelClassName="pop__panel--models tm-panel"
      trigger={
        <>
          <span className="tm-trigger" aria-hidden="true">{TIER[model.tier].icon}</span>
          <span className="pill-btn__text">{model.name}</span>
          <ChevronDown className="pill-btn__chev" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <div className="models" ref={scrollToChosen}>
          {owed > 0 ? (
            <div className="tm-budget tm-budget--owed">
              <span>Owed: {owed} Credits from a chargeback. The Director is paused until new Credits settle the amount.</span>
            </div>
          ) : share !== null && (
            <div className="tm-budget">
              <span>Free today: {Math.round(share * 100)}% left{paying ? "" : " · five times more after your first purchase"}</span>
              <span className="tm-budget__bar" aria-hidden="true"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
            </div>
          )}
          {(Object.keys(TIER) as TextTier[]).map((tier) => (
            <Fragment key={tier}>
              <p className="pop__head tm-head"><span>{TIER[tier].label}</span><span>{tier === "beste" ? "Credits per message" : "free"}</span></p>
              {models.filter((m) => m.tier === tier).map((m) => {
                const used = m.allowed === false;
                const why = m.locked ? LOCKED[m.locked].title : used ? "Used up for today. Pick a faster model or come back tomorrow." : m.paid ? priceLine(m) : undefined;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`models__item tm-item${m.id === model.id ? " is-on" : ""}`}
                    disabled={used}
                    title={why}
                    onClick={() => {
                      onChoose(m.id);
                      close();
                    }}
                  >
                    <span className="models__text">
                      <span className="models__name"><span className="tm-n">{m.name}</span><span className="tm-maker">{m.maker}</span></span>
                      <span className="models__desc">{m.tagline}</span>
                    </span>
                    <span className="tm-side">
                      {m.id === model.id ? (
                        <Check className="models__check" aria-hidden="true" />
                      ) : m.paid && m.credits ? (
                        <span className="tm-price"><TokenGlyph />≈ {m.credits.typical}</span>
                      ) : (
                        <Cost n={m.cost} />
                      )}
                      <span className="tm-left">
                        {m.locked ? LOCKED[m.locked].short
                          : m.paid && m.credits ? `at most ${m.credits.cap}`
                          : used ? "used up today"
                          : m.turnsLeft !== undefined && m.turnsLeft < 100 ? `${m.turnsLeft} left today` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
    </Popover>
  );
}
