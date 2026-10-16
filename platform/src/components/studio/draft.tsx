"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Volume2 } from "lucide-react";
import { modelCover } from "./content";
import { menuFamilies, priceText, splitTagline, type MenuFamily } from "./mega-data";
import { Popover } from "./popover";
import { defaults, modelFacts, modelSpec } from "./schema";
import { useStudio, type CatalogEntry, type Kind } from "./studio-context";
import { TokenGlyph } from "./tachyon-token";
import { usePrices } from "./use-prices";
import "./model-picker.css";

/** A model without a cover shows its first letter: a quiet mark instead of an empty or broken picture. */
const modelInitial = (m?: { model: string } | null) => (m?.model ?? "").trim().charAt(0).toUpperCase();

/**
 * Draft state of one generator: model, prompt, options and the live price.
 * Reads ?model=, ?prompt= and ?from=<jobId> so menus and "Reuse" can prefill it.
 */
export function useDraft(kind: Kind) {
  const { catalog, jobs, quote } = useStudio();
  const search = useSearchParams();
  const models = useMemo(() => catalog.filter((c) => c.kind === kind), [catalog, kind]);
  const [jobType, setJobType] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [opts, setOpts] = useState<Record<string, unknown>>({});
  const [count, setCount] = useState(1);
  const [price, setPrice] = useState<number | null>(null);
  // Bumped to fetch the price again, e.g. after the server answered price_changed.
  const [priceRound, setPriceRound] = useState(0);
  const [seeded, setSeeded] = useState<string | null>(null);

  const model = models.find((m) => m.jobType === jobType);

  // Seed once per distinct query string, after the catalog (and for ?from= the jobs) are loaded.
  useEffect(() => {
    if (!models.length) return;
    const key = search.toString();
    if (seeded === key) return;
    const from = search.get("from");
    const source = from ? jobs.find((j) => j.id === from) : undefined;
    if (from && !source) return; // wait for jobs
    // ?ref=<upload>: a result taken over as reference image; it needs a model that takes references.
    const ref = search.get("ref");
    const takesRefs = (m: CatalogEntry) => Boolean((m.params.properties?.references as { maxItems?: number } | undefined)?.maxItems);
    const wanted = source?.jobType ?? search.get("model") ?? "";
    let pick = models.find((m) => m.jobType === wanted) ?? (models.some((m) => m.jobType === jobType) ? model : models[0]);
    if (ref && pick && !takesRefs(pick)) pick = models.find(takesRefs) ?? pick;
    if (!pick) return;
    setJobType(pick.jobType);
    const base = defaults(pick.params);
    if (source) {
      const { prompt: p, ...rest } = source.params;
      setPrompt(String(p ?? ""));
      setOpts({ ...base, ...rest });
    } else {
      // ?aspect=9:16: a picked example keeps its shape, if the model offers it.
      const aspect = search.get("aspect");
      const aspects = (pick.params.properties?.aspect_ratio as { enum?: unknown[] } | undefined)?.enum;
      if (aspect && aspects?.includes(aspect)) base.aspect_ratio = aspect;
      setOpts(ref && takesRefs(pick) ? { ...base, references: [ref] } : base);
      const p = search.get("prompt");
      if (p) setPrompt(p);
    }
    setSeeded(key);
  }, [models, jobs, search, seeded, jobType, model]);

  function chooseModel(next: CatalogEntry) {
    setJobType(next.jobType);
    // Keep options the new model also offers, else its defaults.
    const base = defaults(next.params);
    const keep = Object.fromEntries(Object.entries(opts).filter(([k, v]) => {
      const s = next.params.properties?.[k];
      return s && (!s.enum || s.enum.includes(v as never));
    }));
    // Reference images: at most as many as the new model takes (the composer then names any @-image left without one).
    const max = (next.params.properties?.references as { maxItems?: number } | undefined)?.maxItems;
    if (Array.isArray(keep.references) && max !== undefined) keep.references = (keep.references as unknown[]).slice(0, max);
    setOpts({ ...base, ...keep });
  }

  const params = useMemo(() => ({ ...opts, prompt: prompt.trim() || "preview" }), [opts, prompt]);
  useEffect(() => {
    if (!model) return;
    let live = true;
    const t = setTimeout(async () => {
      const q = await quote(model.jobType, params);
      if (live) setPrice(q);
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [model, params, quote, priceRound]);

  return {
    models, model, chooseModel, prompt, setPrompt, opts, setOpt: (k: string, v: unknown) => setOpts((o) => ({ ...o, [k]: v })),
    count, setCount, price, total: price === null ? null : price * count, requote: () => setPriceRound((n) => n + 1),
    params: { ...opts, prompt: prompt.trim() },
  };
}

const BADGE = { top: "Top", neu: "New" } as const;

/**
 * Model picker: the models grouped by family (maker once per family), each with what it can do (highest resolution,
 * longest clip, sound) and what it costs at least, so a long list stays easy to scan. Opens above or below its trigger.
 * `row`: the trigger is the whole model row of a generation panel (cover, name, maker and facts).
 */
export function ModelPicker({
  models, model, onChoose, side = "top", variant = "pill",
}: {
  models: CatalogEntry[];
  model?: CatalogEntry;
  onChoose: (m: CatalogEntry) => void;
  side?: "top" | "bottom" | "auto";
  variant?: "pill" | "button" | "row";
}) {
  const kind = model?.kind ?? models[0]?.kind ?? "image";
  const families = menuFamilies(models, kind);
  const cover = (model && modelCover(model)) ?? null;
  return (
    <Popover
      label="Choose model"
      side={side}
      className={variant === "row" ? "pop--block mpick" : variant === "button" ? "pop--block" : ""}
      panelClassName="pop__panel--models mlist-panel"
      trigger={variant === "row" ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover ? <img className="mpick__cover" src={cover} alt="" /> : <span className="mpick__cover model-mark" aria-hidden="true">{modelInitial(model)}</span>}
          <span className="mpick__text">
            <span className="mpick__name">
              {model?.model ?? "Model"}
              {model?.badge && <span className={`tag tag--${model.badge}`}>{BADGE[model.badge]}</span>}
            </span>
            <span className="mpick__sub">{model ? [splitTagline(model.tagline).maker, ...modelFacts(model.params)].filter(Boolean).join(" · ") : "…"}</span>
          </span>
          <span className="mpick__switch">Change<ChevronDown aria-hidden="true" /></span>
        </>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover ? <img className="pill-btn__thumb" src={cover} alt="" /> : <span className="pill-btn__thumb model-mark" aria-hidden="true">{modelInitial(model)}</span>}
          <span className="pill-btn__text">{model?.model ?? "Model"}</span>
          <ChevronDown className="pill-btn__chev" aria-hidden="true" />
        </>
      )}
    >
      {(close) => (
        <ModelList
          families={families}
          model={model}
          onChoose={(m) => {
            onChoose(m);
            close();
          }}
        />
      )}
    </Popover>
  );
}

/**
 * The list inside the picker: family heads, one compact row per model; ↑ ↓ move between models, the chosen one has
 * focus. Prices load with the first open (shared cache), so a failed load is tried again on the next one.
 */
function ModelList({ families, model, onChoose }: {
  families: MenuFamily<CatalogEntry>[]; model?: CatalogEntry; onChoose: (m: CatalogEntry) => void;
}) {
  const prices = usePrices();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current?.querySelector<HTMLButtonElement>(".mlist__item.is-on") ?? list.current?.querySelector<HTMLButtonElement>(".mlist__item");
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  }, []);
  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>(".mlist__item:not(:disabled)") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }
  const count = families.reduce((n, f) => n + f.models.length, 0);
  return (
    <div className="mlist" ref={list} onKeyDown={onKey}>
      <p className="pop__head mlist__head"><span>Model</span><span className="mlist__count">{count}</span></p>
      {families.map((f) => (
        <section key={f.key} className="mlist__family" aria-label={f.maker ? `${f.name}, ${f.maker}` : f.name}>
          <p className="mlist__fam" aria-hidden="true"><span>{f.name}</span>{f.maker && <span className="mlist__maker">{f.maker}</span>}</p>
          {f.models.map((m) => {
            const on = m.jobType === model?.jobType;
            const paused = m.status === "paused";
            const spec = modelSpec(m.params);
            const price = priceText(prices?.get(m.jobType), { short: true });
            return (
              <button key={m.jobType} type="button" className={`mlist__item${on ? " is-on" : ""}`} aria-pressed={on} disabled={paused} onClick={() => onChoose(m)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {modelCover(m) ? <img className="mlist__thumb" src={modelCover(m)} alt="" /> : <span className="mlist__thumb model-mark" aria-hidden="true">{modelInitial(m)}</span>}
                <span className="mlist__name">
                  {m.model}
                  {m.status === "deprecated"
                    ? <span className="tag">Retiring</span>
                    : m.badge && <span className={`tag tag--${m.badge}`}>{BADGE[m.badge]}</span>}
                </span>
                <span className="mlist__price">{paused ? "Paused" : price && <><TokenGlyph />{price}</>}</span>
                <span className="mlist__desc">{splitTagline(m.tagline).text}</span>
                <span className="mlist__facts">
                  {[spec.resolution, spec.seconds && `${spec.seconds.max} s`].filter(Boolean).join(" · ")}
                  {spec.sound && <Volume2 aria-label="with sound" />}
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
