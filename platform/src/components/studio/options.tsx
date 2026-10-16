"use client";

import { Check, ChevronDown, Clock3, Gem, RectangleHorizontal, Volume2 } from "lucide-react";
import { Popover } from "./popover";
import { choices, optionKeys, PARAM_LABEL, ratio, showValue, type JsonSchema } from "./schema";
import "./options.css";

const ICON: Record<string, React.ReactNode> = {
  aspect_ratio: <RectangleHorizontal aria-hidden="true" />,
  resolution: <Gem aria-hidden="true" />,
  duration: <Clock3 aria-hidden="true" />,
  generate_audio: <Volume2 aria-hidden="true" />,
};

function AspectGlyph({ value }: { value: string }) {
  const r = ratio(value);
  const w = r >= 1 ? 22 : 22 * r;
  const h = r >= 1 ? 22 / r : 22;
  return <span className="aspect-glyph" style={{ width: w, height: h }} aria-hidden="true" />;
}

/**
 * One field per model option (format, resolution, duration, sound), each with its own picker. `hide` leaves out options
 * a page sets elsewhere (recast's mode). Long duration lists (up to 30 s) open as a grid of seconds. The label inside
 * the trigger shows only where a page asks for it (the video panel's settings grid, `.gp-opts`).
 */
export function OptionPills({ schema, opts, setOpt, side = "top", hide = [] }: {
  schema: JsonSchema; opts: Record<string, unknown>; setOpt: (k: string, v: unknown) => void; side?: "top" | "bottom" | "auto"; hide?: string[];
}) {
  return (
    <>
      {optionKeys(schema).filter((key) => !hide.includes(key)).map((key) => {
        const values = choices(schema.properties![key]!)!;
        const current = opts[key];
        const grid = key === "aspect_ratio" ? " choice--grid" : key === "duration" && values.length > 6 ? " choice--nums" : "";
        return (
          <Popover
            key={key}
            label={PARAM_LABEL[key] ?? key}
            side={side}
            trigger={
              <>
                {ICON[key]}
                <span className="pill-btn__label">{PARAM_LABEL[key] ?? key}</span>
                <span className={`pill-btn__text${current === undefined ? " is-empty" : ""}`}>{current === undefined ? PARAM_LABEL[key] : showValue(key, current)}</span>
                <ChevronDown className="pill-btn__chev" aria-hidden="true" />
              </>
            }
          >
            {(close) => (
              <div className={`choice${grid}`}>
                <p className="pop__head">{PARAM_LABEL[key] ?? key}</p>
                {values.map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    className={`choice__item${current === v ? " is-on" : ""}`}
                    onClick={() => {
                      setOpt(key, v);
                      close();
                    }}
                  >
                    {key === "aspect_ratio" && <AspectGlyph value={String(v)} />}
                    <span>{showValue(key, v)}</span>
                    {current === v && !grid && <Check className="choice__check" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        );
      })}
    </>
  );
}

/** Segmented chips for a side panel (video): every option visible at once. */
export function OptionChips({ schema, opts, setOpt, hide = [] }: { schema: JsonSchema; opts: Record<string, unknown>; setOpt: (k: string, v: unknown) => void; hide?: string[] }) {
  return (
    <div className="opts">
      {optionKeys(schema).filter((key) => !hide.includes(key)).map((key) => {
        const values = choices(schema.properties![key]!)!;
        return (
          <div className="opts__row" key={key}>
            <span className="opts__label" id={`opt-${key}`}>{PARAM_LABEL[key] ?? key}</span>
            <div className="seg" role="group" aria-labelledby={`opt-${key}`}>
              {values.map((v) => (
                <button key={String(v)} type="button" className="seg__item" aria-pressed={opts[key] === v} onClick={() => setOpt(key, v)}>
                  {showValue(key, v)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
