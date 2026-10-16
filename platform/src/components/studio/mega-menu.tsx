"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { modelCover } from "./content";
import {
  kindTools, megaPlacement, menuFamilies, menuStep, posterLines, priceText, SOON, splitTagline, stampLines,
  type Badge, type Kind, type Menu, type MenuFamily, type MenuTool, type Placement,
} from "./mega-data";
import { useStudio, type CatalogEntry } from "./studio-context";
import { usePrices, type Price } from "./use-prices";
import "./mega-menu.css";

export type { Menu } from "./mega-data";

const BADGE: Record<Badge, string> = { top: "Top", neu: "New" };
const LABEL: Record<Menu, string> = { image: "Image", video: "Video" };
/** As long as the closing blind runs in mega-menu.css (.mg.is-closing). */
const CLOSE_MS = 380;
const TRIGGER = '[aria-controls="hd-mega"][aria-expanded="true"]';
const FOCUSABLE = "a[href], button:not([disabled])";
const pad = (n: number) => String(n).padStart(2, "0");

type Props = {
  /** The open menu; null closes it (the panel stays for its closing blind, then leaves). */
  menu: Menu | null;
  /** The header: the panel opens flush under its visible bar (`.hd__bar`, else the header itself), measured on every open. */
  header: React.RefObject<HTMLElement | null>;
  /** The panel element, for the header's click-outside. */
  ref?: React.Ref<HTMLDivElement>;
  onEnter: () => void;
  onLeave: () => void;
  /** Closes the menu (a link was taken, or the focus left the panel). */
  onNavigate: () => void;
};

/**
 * The header's mega menus in the grammar of our template (Bulletproof, as on Explore): the panel drops like a blind
 * from under the bar and dims the page, its lines rise one after another, lists dim the rows the pointer is not on,
 * and a poster on the right follows the row under the pointer with its picture, its name in giant type and its price.
 * Menus switch in place: the content slides in from the side of the word the pointer came from.
 */
export function MegaPanel({ menu, header, ref, onEnter, onLeave, onNavigate }: Props) {
  const { catalog } = useStudio();
  const prices = usePrices();
  const [shown, setShown] = useState<Menu | null>(null);
  const [closing, setClosing] = useState(false);
  const [dir, setDir] = useState<-1 | 0 | 1>(0);
  const [place, setPlace] = useState<Placement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const last = useRef<Menu | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const own = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const setRefs = useCallback((el: HTMLDivElement | null) => {
    own.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = el;
  }, [ref]);

  const measure = useCallback(() => {
    const h = header.current;
    if (!h) return;
    const bar = (h.querySelector<HTMLElement>(".hd__bar") ?? h).getBoundingClientRect();
    setPlace(megaPlacement({ left: bar.left, width: bar.width, bottom: bar.bottom }, document.documentElement.clientWidth));
  }, [header]);

  // Open, switch, close. Measured before paint, so the panel never shows up at the old place.
  useLayoutEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (menu) {
      measure();
      setDir(menuStep(last.current, menu));
      last.current = menu;
      setShown(menu);
      setClosing(false);
      return;
    }
    if (!last.current) return;
    last.current = null;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setClosing(true);
    timer.current = setTimeout(() => {
      setShown(null);
      setClosing(false);
      setHeight(null);
    }, still ? 0 : CLOSE_MS);
  }, [menu, measure]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // The panel follows its content's height, so switching menus glides instead of jumping.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!shown || !el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [shown]);

  // A new width re-measures; below the desktop header (no words to hover) the menu closes.
  useEffect(() => {
    if (!menu) return;
    const onResize = () => (window.innerWidth < 1100 ? onNavigate() : measure());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [menu, measure, onNavigate]);

  // Arrow down on the menu's word in the header moves into the menu.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" || !(e.target instanceof Element) || !e.target.matches(TRIGGER)) return;
      e.preventDefault();
      own.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  /** Arrows walk the links, Escape goes back to the word, Tab past the end goes on to the next word in the header. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = [...(own.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const at = list.indexOf(document.activeElement as HTMLElement);
    const trigger = document.querySelector<HTMLElement>(TRIGGER);
    if (e.key === "Escape") {
      trigger?.focus();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && list.length) {
      e.preventDefault();
      list[e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length]?.focus();
    } else if ((e.key === "Home" || e.key === "End") && list.length) {
      e.preventDefault();
      list[e.key === "Home" ? 0 : list.length - 1]?.focus();
    } else if (e.key === "Tab" && e.shiftKey && at === 0 && trigger) {
      e.preventDefault();
      trigger.focus();
    } else if (e.key === "Tab" && !e.shiftKey && at === list.length - 1 && trigger) {
      e.preventDefault();
      const words = [...(trigger.closest("header")?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      onNavigate();
      words[words.indexOf(trigger) + 1]?.focus();
    }
  };

  if (!shown) return null;
  const style = {
    "--mg-top": `${place?.top ?? 72}px`,
    "--mg-left": `${place?.left ?? 0}px`,
    "--mg-width": place ? `${place.width}px` : "100vw",
    ...(height !== null ? { "--mg-h": `${height}px` } : {}),
  } as React.CSSProperties;

  return createPortal(
    <>
      <div className={`mg-scrim${closing ? " is-closing" : ""}`} style={style} aria-hidden="true" />
      {/* Flush under a full-width bar: the same glass behind the bar, so bar and menu are one sheet (also over a hero). */}
      {place?.mode !== "float" && <div className={`mg-cap${closing ? " is-closing" : ""}`} style={style} aria-hidden="true" />}
      <div
        ref={setRefs}
        id="hd-mega"
        className={`mg mg--${place?.mode ?? "flush"}${closing ? " is-closing" : ""}`}
        style={style}
        role="region"
        aria-label={`${LABEL[shown]} menu`}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onKeyDown={onKeyDown}
      >
        <div className="mg__scroll" ref={scroller}>
          <div className="mg__inner">
            <div key={shown} className="mg__content" style={{ "--dir": dir } as React.CSSProperties}>
              <KindMenu kind={shown} catalog={catalog} prices={prices} onNavigate={onNavigate} />
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** What the poster shows: a tool or a model (with its cover and price). */
type Item = { key: string; title: string; desc: string; href: string; eyebrow: string; badge: Badge | null; price: string | null; image?: string };

/** Image and Video: the tools as a numbered index, the models by family with their price, the poster beside them. */
function KindMenu({ kind, catalog, prices, onNavigate }: { kind: Kind; catalog: CatalogEntry[]; prices: Map<string, Price> | null; onNavigate: () => void }) {
  const tools = kindTools(kind);
  const families = menuFamilies(catalog, kind);
  const count = families.reduce((n, f) => n + f.models.length, 0);
  const base = kind === "image" ? "/image" : "/video";
  const toolItem = (t: MenuTool): Item => ({ key: `t:${t.title}`, title: t.title, desc: t.desc, href: t.href, eyebrow: "Tool", badge: t.badge ?? null, price: null });
  const modelItem = (m: CatalogEntry, f: MenuFamily<CatalogEntry>): Item => ({
    key: `m:${m.jobType}`,
    title: m.model,
    desc: splitTagline(m.tagline).text,
    href: `${base}?model=${m.jobType}`,
    eyebrow: f.maker ? `${f.name} · ${f.maker}` : f.name,
    badge: m.badge,
    price: priceText(prices?.get(m.jobType)),
    image: modelCover(m),
  });
  const items = [...tools.map(toolItem), ...families.flatMap((f) => f.models.filter((m) => m.status !== "paused").map((m) => modelItem(m, f)))];
  const [active, setActive] = useState<string | null>(null);
  const current = items.find((i) => i.key === active) ?? items[0];
  // Long names shrink the index type so every tool stays on one line, also in the narrow floating card.
  const longest = Math.max(...tools.map((t) => [...t.title].length), 8);

  return (
    <>
      <div className="mg-kind">
        <section className="mg-col" aria-label="Tools">
          <p className="mg-head">Tools <span className="mg-head__count">{pad(tools.length)}</span></p>
          <ol className="mg-index" style={{ "--longest": longest } as React.CSSProperties}>
            {tools.map((t, i) => {
              const key = `t:${t.title}`;
              return (
                <li key={key} style={{ "--i": i } as React.CSSProperties}>
                  <Link
                    href={t.href}
                    className={`mg-index__row${current?.key === key ? " is-on" : ""}`}
                    onClick={onNavigate}
                    onMouseEnter={() => setActive(key)}
                    onFocus={() => setActive(key)}
                  >
                    <span className="mg-index__num" aria-hidden="true">{pad(i + 1)}</span>
                    <span className="mg-index__name"><span className="mg-rise">{t.title}</span></span>
                    {t.badge && <span className={`mg-badge mg-badge--${t.badge}`}>{BADGE[t.badge]}</span>}
                    <ArrowRight className="mg-index__arrow" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ol>
          {SOON[kind].length > 0 && (
            <p className="mg-soon"><span className="mg-soon__label">Soon</span>{SOON[kind].map((s) => <span key={s}>{s}</span>)}</p>
          )}
        </section>

        <section className="mg-col" aria-label="Models">
          <p className="mg-head">Models <span className="mg-head__count">{count ? pad(count) : ""}</span><span className="mg-head__end">Credits</span></p>
          <div className="mg-families">
            {families.map((f, fi) => (
              <div key={f.key} className="mg-family" style={{ "--i": fi + 1 } as React.CSSProperties}>
                <p className="mg-family__head"><span className="mg-family__name">{f.name}</span>{f.maker && <span className="mg-family__maker">{f.maker}</span>}</p>
                <ul className="mg-family__list">
                  {f.models.map((m) => {
                    const key = `m:${m.jobType}`;
                    const price = priceText(prices?.get(m.jobType), { short: true });
                    const body = (
                      <>
                        <span className="mg-model__name">
                          <span className="mg-model__label">{m.model}</span>
                          {m.badge && <span className={`mg-badge mg-badge--${m.badge}`}>{BADGE[m.badge]}</span>}
                          {m.status === "paused" && <span className="tag">Paused</span>}
                          {m.status === "deprecated" && <span className="tag">Retiring</span>}
                        </span>
                        <span className="mg-model__price">{m.status === "paused" ? "" : price}</span>
                        <span className="mg-model__desc">{f.maker ? splitTagline(m.tagline).text : m.tagline}</span>
                      </>
                    );
                    // A paused model takes no jobs: listed, so nobody wonders where it went, but not clickable.
                    return (
                      <li key={key}>
                        {m.status === "paused" ? (
                          <span className="mg-model is-off" aria-disabled="true">{body}</span>
                        ) : (
                          <Link
                            href={`${base}?model=${m.jobType}`}
                            className={`mg-model${current?.key === key ? " is-on" : ""}`}
                            onClick={onNavigate}
                            onMouseEnter={() => setActive(key)}
                            onFocus={() => setActive(key)}
                          >
                            {body}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {current && <Poster items={items} current={current} onNavigate={onNavigate} />}
      </div>

      <footer className="mg-foot">
        <p className="mg-foot__note">
          {kind === "image"
            ? "Prices in Credits, shown before every start. New models appear here automatically."
            : "Prices in Credits, shown before every start. If a clip fails, the Credits come back."}
        </p>
        <div className="mg-foot__actions">
          <Link href="/assets" className="mg-link" onClick={onNavigate}>All results <ArrowUpRight aria-hidden="true" /></Link>
          <Link href={base} className="mg-cta" onClick={onNavigate}>
            <span className="mg-cta__text">{kind === "image" ? "Create image" : "Create video"}</span>
            <span className="mg-cta__arrow"><ArrowRight aria-hidden="true" /></span>
          </Link>
        </div>
      </footer>
    </>
  );
}

/**
 * The poster beside the lists: the picture of the row under the pointer, its name in giant type, its description as
 * a stamp.
 */
function Poster({ items, current, onNavigate }: { items: Item[]; current: Item; onNavigate: () => void }) {
  const lines = posterLines(current.title);
  // The second line is set in from the left, so it counts a little longer.
  const len = Math.max(...lines.map((l, i) => [...l].length + (i % 2 ? 0.8 : 0)), 4);
  const images = [...new Set(items.map((i) => i.image).filter((s): s is string => Boolean(s)))];
  return (
    <Link href={current.href} className="mg-poster theme-dark" onClick={onNavigate} aria-label={`Open ${current.title}`}>
      {images.map((src) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} className={`mg-poster__img${src === current.image ? " is-on" : ""}`} src={src} alt="" decoding="async" />
      ))}
      <span className="mg-poster__shade" aria-hidden="true" />
      <span className="mg-poster__top" aria-hidden="true">
        <span>{current.eyebrow}{current.badge && ` · ${BADGE[current.badge]}`}</span>
        {current.price && <span className="mg-poster__price">{current.price}</span>}
      </span>
      {/* Calm: name and description together at the foot, the arrow beside them. */}
      <span className="mg-poster__body" aria-hidden="true">
        <span key={`l:${current.key}`} className="mg-poster__letters" style={{ "--len": len } as React.CSSProperties}>
          {lines.map((l, i) => <span key={i} className="mg-poster__row" style={{ "--i": i } as React.CSSProperties}><span>{l}</span></span>)}
        </span>
        <span key={`s:${current.key}`} className="mg-poster__stamp">
          {stampLines(current.desc).map((s, i) => <span key={i} style={{ "--i": i } as React.CSSProperties}><span>{s}</span></span>)}
        </span>
        <span className="mg-poster__foot">
          <span className="mg-poster__credit" />
          <span className="mg-poster__cta"><ArrowRight /></span>
        </span>
      </span>
    </Link>
  );
}
