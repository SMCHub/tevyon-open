"use client";

import { useState } from "react";
import Link from "next/link";
import { TokenGlyph } from "@/components/studio/tachyon-token";
import { searchProjects, sortProjects, type Category, type Product, type Style, type View } from "./data";
import {
  GAgent, GBag, GBox, GCamera, GChevron, GClose, GFolder, GHome, GMegaphone, GPanel, GPerson, GPin, GPlay, GPlus, GPoster, GReference, GSearch, GSort,
  GStack, GStar,
} from "./icons";
import { NameField, nextSort, ProjectCover, ProjectMenu, SORT_LABEL, type ProjectsApi } from "./projects";

export const CATEGORY_ICON: Record<string, React.ReactNode> = {
  ugc: <GPerson />, product: <GCamera />, motion: <GPlay />, ads: <GMegaphone />, posters: <GPoster />, marketplace: <GBag />,
};

type Props = {
  view: View;
  onView: (v: View) => void;
  collapsed: boolean;
  onCollapsed: (c: boolean) => void;
  /** Phones and small tablets: the sidebar is a drawer. */
  open: boolean;
  onClose: () => void;
  categories: Category[];
  styles: Style[];
  templates: Style[];
  category: string;
  styleId: string | null;
  onCategory: (id: string) => void;
  onStyle: (s: Style) => void;
  onSearch: (q: string) => void;
  counts: { generations: number; favorites: number; products: number; references: number; running: number };
  products: Product[];
  productId: string | null;
  onProduct: (id: string) => void;
  projects: ProjectsApi;
  projectId: string | null;
  credits: number | null;
};

/**
 * The Marketing Agent's sidebar (Home, My generations, Favourites, ad references, product link, projects with search
 * and sort, pricing) plus the agent and the template categories: each category opens to its styles. It collapses to icons on desktop and is a drawer on small screens.
 */
export function Sidebar(p: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pq, setPq] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const slim = p.collapsed && !p.open;
  const projects = searchProjects(sortProjects(p.projects.list, p.projects.sort, p.projects.lastActive), pq ?? "");

  function go(v: View) {
    p.onView(v);
    p.onClose();
  }
  const item = (v: View, icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <button
      type="button"
      className={`ma-nav__item${p.view === v ? " is-on" : ""}`}
      onClick={() => go(v)}
      aria-current={p.view === v ? "page" : undefined}
      title={slim ? label : undefined}
      aria-label={slim ? label : undefined}
    >
      {icon}<span className="ma-nav__label">{label}</span>{extra}
    </button>
  );
  const count = (n: number) => (n > 0 ? <span className="ma-nav__count">{n}</span> : null);

  return (
    <>
      {p.open && <div className="ma-backdrop" onClick={p.onClose} aria-hidden="true" />}
      <aside className={`ma-side${slim ? " is-slim" : ""}${p.open ? " is-open" : ""}`} aria-label="Marketing Agent">
        <div className="ma-side__head">
          <span className="ma-side__brand">Marketing Agent</span>
          <button type="button" className="ma-side__toggle" onClick={() => p.onCollapsed(!p.collapsed)} aria-label={p.collapsed ? "Expand sidebar" : "Collapse sidebar"} title={p.collapsed ? "Expand" : "Collapse"}>
            <GPanel open={!p.collapsed} />
          </button>
          <button type="button" className="ma-side__close" onClick={p.onClose} aria-label="Close menu"><GClose /></button>
        </div>

        <nav className="ma-nav" aria-label="Sections">
          <div className="ma-nav__group">
            {item("home", <GHome />, "Home")}
            {item("agent", <GAgent />, "Plan campaign", <span className="ma-nav__tag">AI</span>)}
          </div>

          <div className="ma-nav__group">
            <span className="ma-nav__head">Library</span>
            {item("generations", <GStack />, "My generations", p.counts.running > 0 ? <span className="ma-nav__live" aria-label={`${p.counts.running} running`}>{p.counts.running}</span> : count(p.counts.generations))}
            {item("favorites", <GStar />, "Favourites", count(p.counts.favorites))}
            {item("products", <GBox />, "Products & product link", count(p.counts.products))}
            {item("references", <GReference />, "Ad references", count(p.counts.references))}
          </div>

          <div className="ma-nav__group">
            <div className="ma-nav__headrow">
              <span className="ma-nav__head">Projects</span>
              {!slim && (
                <span className="ma-nav__tools">
                  <button type="button" onClick={() => setPq((v) => (v === null ? "" : null))} aria-pressed={pq !== null} aria-label="Search projects" title="Search projects"><GSearch /></button>
                  <button type="button" onClick={() => p.projects.onSort(nextSort(p.projects.sort))} aria-label={`Sorting: ${SORT_LABEL[p.projects.sort]}, change`} title={SORT_LABEL[p.projects.sort]}><GSort /></button>
                </span>
              )}
            </div>
            {pq !== null && !slim && (
              <label className="ma-search">
                <GSearch />
                <input type="search" value={pq} onChange={(e) => setPq(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setPq(null)} placeholder="Search projects" aria-label="Search projects" autoFocus />
              </label>
            )}
            <button type="button" className="ma-nav__item ma-nav__item--new" onClick={() => { p.projects.create(); p.onClose(); }} title={slim ? "New project" : undefined} aria-label={slim ? "New project" : undefined}>
              <GPlus /><span className="ma-nav__label">New project</span>
            </button>
            {projects.slice(0, slim ? 5 : 6).map((x) => {
              const on = p.view === "project" && p.projectId === x.id;
              return (
                <div key={x.id} className={`ma-proj${on ? " is-on" : ""}`}>
                  {renaming === x.id && !slim ? (
                    <span className="ma-nav__item ma-proj__edit"><ProjectCover cover={p.projects.cover(x)} size="sm" /><NameField value={x.name} onSave={(n) => p.projects.rename(x.id, n)} onDone={() => setRenaming(null)} /></span>
                  ) : (
                    <button type="button" className={`ma-nav__item ma-proj__main${on ? " is-on" : ""}`} onClick={() => { p.projects.open(x.id); p.onClose(); }} aria-current={on ? "page" : undefined} title={slim ? x.name : undefined} aria-label={slim ? `Project ${x.name}` : undefined}>
                      <ProjectCover cover={p.projects.cover(x)} size="sm" />
                      <span className="ma-nav__label">{x.name}</span>
                      {x.pinned && !slim && <span className="ma-proj__pin" role="img" aria-label="Pinned"><GPin /></span>}
                    </button>
                  )}
                  {!slim && renaming !== x.id && <ProjectMenu project={x} api={p.projects} onRename={() => setRenaming(x.id)} align="start" />}
                </div>
              );
            })}
            {pq !== null && !slim && !projects.length && <p className="ma-nav__empty">No project found.</p>}
            {item("projects", <GFolder />, "All projects", count(p.projects.list.length))}
          </div>

          <div className="ma-nav__group">
            <span className="ma-nav__head">Templates</span>
            {!slim && (
              <label className="ma-search">
                <GSearch />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      p.onSearch(q.trim());
                      p.onClose();
                    }
                  }}
                  placeholder="Search templates"
                  aria-label="Search templates, Enter shows the matches"
                />
              </label>
            )}
            {(["image", "video"] as const).map((kind) => (
              <div key={kind} className="ma-cats">
                {!slim && <span className="ma-nav__sub">{kind === "image" ? "Image" : "Video"}</span>}
                {p.categories.filter((c) => c.kind === kind).map((c) => {
                  const open = expanded === c.id && !slim;
                  const styles = p.styles.filter((s) => s.category === c.id);
                  const n = p.templates.filter((t) => t.category === c.id).length;
                  const on = p.view === "home" && p.category === c.id;
                  return (
                    <div key={c.id} className={`ma-cat${open ? " is-open" : ""}`}>
                      <div className={`ma-cat__row${on ? " is-on" : ""}`}>
                        <button type="button" className="ma-nav__item ma-cat__main" onClick={() => { p.onCategory(c.id); p.onClose(); }} title={slim ? c.label : undefined} aria-label={slim ? c.label : undefined} aria-current={on ? "true" : undefined}>
                          {CATEGORY_ICON[c.id]}<span className="ma-nav__label">{c.label}</span>{!slim && <span className="ma-nav__count ma-nav__count--soft">{n}</span>}
                        </button>
                        {!slim && (
                          <button type="button" className="ma-cat__toggle" onClick={() => setExpanded(open ? null : c.id)} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} the styles of ${c.label}`}>
                            <GChevron />
                          </button>
                        )}
                      </div>
                      {open && (
                        <ul className="ma-cat__styles">
                          {styles.map((s) => (
                            <li key={s.id}>
                              <button type="button" className={`ma-cat__style${p.styleId === s.id ? " is-on" : ""}`} onClick={() => { p.onStyle(s); p.onClose(); }} disabled={!s.available}>
                                {s.title}{!s.available && <em> · soon</em>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {p.products.length > 0 && !slim && (
            <div className="ma-nav__group">
              <span className="ma-nav__head">Recently used</span>
              <div className="ma-products">
                {p.products.slice(0, 6).map((x) => (
                  <button key={x.id} type="button" className={`ma-product${x.id === p.productId ? " is-on" : ""}`} onClick={() => { p.onProduct(x.id); p.onClose(); }} title={x.name} aria-label={`Choose product ${x.name}`} aria-pressed={x.id === p.productId}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={x.images[x.pick] ?? x.images[0]} alt="" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="ma-side__foot">
          <Link href="/credits" className="ma-nav__item" title={slim ? "Pricing & Credits" : undefined} aria-label={slim ? "Pricing & Credits" : undefined}>
            <TokenGlyph className="ma-glyph ma-glyph--token" /><span className="ma-nav__label">Pricing & Credits</span>{p.credits !== null && !slim && <span className="ma-nav__count ma-nav__count--soft">{p.credits}</span>}
          </Link>
        </div>
      </aside>
    </>
  );
}
