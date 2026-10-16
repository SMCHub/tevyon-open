"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Image as ImageIcon, Play, Search, Video, X } from "lucide-react";
import { PreviewButton, usePreview } from "@/components/studio/media-preview";
import type { PreviewEntry } from "@/components/studio/preview";
import { TokenGlyph } from "@/components/studio/tachyon-token";
import { filterTemplates, ratioOf, type Category, type Kind, type Style, type TemplateFilter } from "./data";
import { GArrow, GClose, GImage, GPlay, GSearch, GVideo } from "./icons";

export function AspectBox({ value, size = 14 }: { value: string; size?: number }) {
  const r = ratioOf(value);
  return <span className="ms-aspect" style={{ width: r >= 1 ? size : size * r, height: r >= 1 ? size / r : size }} aria-hidden="true" />;
}

/** A cover image that fades in once loaded and hides itself when it does not exist. */
export function Cover({ src, alt = "", eager = false }: { src: string | null; alt?: string; eager?: boolean }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  if (!src || state === "error") return <span className="ms-cover ms-cover--empty" aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`ms-cover${state === "ok" ? " is-loaded" : ""}`}
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => setState("ok")}
      onError={() => setState("error")}
      ref={(img) => {
        // A cached image is complete before React attaches onLoad.
        if (img?.complete && img.naturalWidth > 0 && state === "loading") setState("ok");
      }}
    />
  );
}

const CATEGORY_LINE: Record<string, string> = {
  product: "Cut-outs, scenes and model photos that sell",
  ads: "Claims, callouts, before/after and sales",
  posters: "Posters with attitude, from Swiss grid to neon",
  marketplace: "Main image, benefits, dimensions and contents",
  ugc: "A person holds your product and talks about it",
  motion: "Your product in motion, with sound",
};
const PER_SECTION = 8;
/** Stills first (what most products need first), then video. */
const ORDER = ["product", "ads", "posters", "marketplace", "ugc", "motion"];
const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
const ordered = (cs: Category[]) => [...cs].sort((a, b) => rank(a.id) - rank(b.id));

/**
 * Templates on the stage: by default one curated section per category (its first templates, “Show all”), a grid
 * once a category, a media type or a search narrows it. Search covers title, style and group.
 */
export function TemplateExplorer({ categories, styles, templates, filter, onFilter, activeId, onUse, loading }: {
  categories: Category[]; styles: Style[]; templates: Style[]; filter: TemplateFilter; onFilter: (f: Partial<TemplateFilter>) => void;
  activeId: string | null; onUse: (s: Style) => void; loading: boolean;
}) {
  const list = useMemo(() => filterTemplates(templates, styles, filter), [templates, styles, filter]);
  const count = (id: string) => filterTemplates(templates, styles, { ...filter, category: id }).length;
  const sections = filter.category === "all" && !filter.q.trim();
  const cats = ordered(categories);
  const preview = usePreview();
  const withCover = list.filter((s) => s.cover !== null);
  const entries = withCover.map((s): PreviewEntry => ({
    url: s.cover!,
    kind: "image",
    chip: s.kind === "video" ? "Video template" : "Image template",
    title: s.title,
    action: s.available ? { label: "Recreate", run: () => onUse(s), credits: s.credits } : { label: "Coming soon", disabled: true },
  }));
  const card = (s: Style, i: number) => (
    <TemplateCard key={s.id} s={s} on={s.id === activeId} eager={i < 6} onUse={onUse} onPreview={s.cover ? () => preview.openEntries(entries, withCover.indexOf(s)) : undefined} />
  );
  return (
    <section className="ma-explore" aria-label="Templates" id="templates">
      <div className="ma-filterbar">
        <div className="ma-tabs" role="tablist" aria-label="Category">
          <button type="button" role="tab" aria-selected={filter.category === "all"} className="ma-tab" onClick={() => onFilter({ category: "all" })}>All <span>{count("all")}</span></button>
          {cats.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={filter.category === c.id} className="ma-tab" onClick={() => onFilter({ category: c.id })}>
              {c.label} <span>{count(c.id)}</span>
            </button>
          ))}
        </div>
        <div className="ma-filterbar__end">
          <div className="ma-media ma-media--glyphs" role="radiogroup" aria-label="Media type">
            {([["all", "All", null], ["image", "Images", <GImage key="i" />], ["video", "Videos", <GVideo key="v" />]] as const).map(([v, l, icon]) => (
              <button key={v} type="button" role="radio" aria-checked={filter.media === v} className={filter.media === v ? "is-on" : ""} onClick={() => onFilter({ media: v })} aria-label={l} title={l}>
                {icon ?? l}
              </button>
            ))}
          </div>
          <label className="ms-search ma-search-wide">
            <GSearch />
            <input value={filter.q} onChange={(e) => onFilter({ q: e.target.value })} placeholder="Search templates" aria-label="Search templates" type="search" />
            {filter.q && <button type="button" className="ms-search__clear" onClick={() => onFilter({ q: "" })} aria-label="Clear search"><GClose /></button>}
          </label>
        </div>
      </div>

      {loading ? (
        <div className="ma-grid" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <span key={i} className="ma-tpl ma-tpl--skel"><span className="ms-skel" /></span>)}</div>
      ) : !list.length ? (
        <div className="empty empty--compact">
          <Search aria-hidden="true" />
          <p>No template matches{filter.q ? <> “{filter.q}”</> : null}.</p>
          <button type="button" className="btn" onClick={() => onFilter({ q: "", category: "all", media: "all" })}>Reset filters</button>
        </div>
      ) : sections ? (
        cats.map((c) => ({ c, items: list.filter((t) => t.category === c.id) })).filter((x) => x.items.length).map(({ c, items }, i) => (
          <section key={c.id} className="ma-section" aria-label={c.label}>
            <header className="ma-section__head">
              <span className="ma-section__no" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <span className="ma-section__text">
                <h3>{c.label}<em>{c.kind === "video" ? "Video" : "Image"} · {items.length}</em></h3>
                <p>{CATEGORY_LINE[c.id] ?? ""}</p>
              </span>
              {items.length > PER_SECTION && (
                <button type="button" className="ma-section__all" onClick={() => onFilter({ category: c.id })}>All {items.length} <GArrow /></button>
              )}
            </header>
            <div className="ma-grid">{items.slice(0, PER_SECTION).map(card)}</div>
          </section>
        ))
      ) : (
        <div className="ma-grid">{list.map(card)}</div>
      )}
    </section>
  );
}

/**
 * A template: the cover alone in 4:5 (its own type stays readable), name and price below it like a catalogue. Hover
 * brings “Recreate” onto the picture; the chosen one carries a ring and says so.
 */
export function TemplateCard({ s, on, eager, onUse, onPreview }: { s: Style; on: boolean; eager: boolean; onUse: (s: Style) => void; onPreview?: () => void }) {
  return (
    <div className={`ma-tpl${on ? " is-on" : ""}${s.available ? "" : " is-off"}`}>
      <button type="button" className="ma-tpl__hit" onClick={() => onUse(s)} disabled={!s.available} aria-pressed={on} aria-label={`Template ${s.title}${s.credits !== null ? `, from ${s.credits} Credits` : ""}`}>
        <span className="ma-tpl__media">
          <Cover src={s.cover} alt={s.title} eager={eager} />
          {s.kind === "video" && <span className="ma-tpl__kind" aria-hidden="true"><GPlay /></span>}
          <span className="ma-tpl__cta">{on ? <><Check aria-hidden="true" /> Selected</> : s.available ? <>Recreate{s.credits !== null && <> · <TokenGlyph />{s.credits}</>}</> : "Soon"}</span>
        </span>
        <span className="ma-tpl__meta">
          <span className="ma-tpl__title">{s.title}</span>
          <span className="ma-tpl__sub">
            {s.badge && <em className="ma-tpl__badge">{s.badge === "neu" ? "New" : "Top"}</em>}
            {s.kind === "video" ? "Video" : "Image"}{s.credits !== null && <> · from {s.credits}</>}
          </span>
        </span>
      </button>
      {onPreview && <PreviewButton className="pv-open--left" onOpen={onPreview} />}
    </div>
  );
}

/** “Choose style”: categories on the left, styles and templates as a grid, search over all of them. */
export function StyleDialog({ categories, styles, templates, current, category, onChoose, onClose }: {
  categories: Category[]; styles: Style[]; templates: Style[]; current: string | null; category: string; onChoose: (s: Style) => void; onClose: () => void;
}) {
  const [cat, setCat] = useState(category);
  const [q, setQ] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  // The page re-renders behind the dialog (job polling): a new onClose must not run this again and move the focus.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      // Keep the focus inside the dialog.
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), input")];
        const first = f[0], last = f.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, []);
  const all = [...styles, ...templates];
  const list = q.trim() ? filterTemplates(all, styles, { category: "all", media: "all", q }) : all.filter((s) => s.category === cat);
  const groups = (kind: Kind) => categories.filter((c) => c.kind === kind);
  return (
    <div className="ms-dialog" role="dialog" aria-modal="true" aria-label="Choose style" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ms-dialog__panel" ref={panel}>
        <div className="ms-dialog__head">
          <h2>Choose style</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="ms-dialog__body">
          <aside className="ms-dialog__nav">
            {(["image", "video"] as const).map((k) => (
              <div key={k} className="ms-dialog__navgroup">
                <span className="ms-dialog__navhead">{k === "image" ? "Image" : "Video"}</span>
                {groups(k).map((c) => (
                  <button key={c.id} type="button" className={`ms-dialog__navitem${cat === c.id && !q.trim() ? " is-on" : ""}`} onClick={() => { setCat(c.id); setQ(""); }}>
                    {k === "video" ? <Video /> : <ImageIcon />}{c.label}
                  </button>
                ))}
              </div>
            ))}
          </aside>
          <div className="ms-dialog__content">
            <div className="ms-dialog__bar">
              <span className="ms-dialog__cat">{q.trim() ? `Search “${q.trim()}” · ${list.length}` : categories.find((c) => c.id === cat)?.label}</span>
              <label className="ms-search">
                <Search aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search styles" type="search" />
              </label>
            </div>
            <div className="ms-dialog__grid">
              {list.map((s) => (
                <button key={s.id} type="button" className={`ms-scard${s.id === current ? " is-on" : ""}`} onClick={() => onChoose(s)} disabled={!s.available} aria-pressed={s.id === current}>
                  <span className="ms-scard__media"><Cover src={s.cover} alt="" />{s.kind === "video" && <span className="ms-tile__play"><Play /></span>}</span>
                  <span className="ms-scard__name">{s.title}{!s.base && <span className="ms-scard__tag">Style</span>}</span>
                </button>
              ))}
              {!list.length && <p className="ms-fine">Nothing found.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
