"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight, Clapperboard, Coins, Flame, FolderOpen, Image as ImageIcon, ImagePlus, KeyRound, LayoutGrid, Megaphone, Search, Sparkles,
  UserRound, Users, Wand2,
} from "lucide-react";
import { searchCommands, type Command } from "./command-search";
import { usePresets } from "./presets-data";
import { useStudio } from "./studio-context";
import "./command-palette.css";

type Item = Command & { icon: React.ReactNode; href?: string; run?: () => void };

const PAGES: Item[] = [
  { id: "p-community", group: "Pages", label: "Community", hint: "What others share", href: "/community", icon: <Users />, keywords: ["shared", "public", "gallery", "feed", "others"] },
  { id: "p-profile", group: "Pages", label: "Profile", hint: "Usage, creations, sharing", href: "/profile", icon: <UserRound />, keywords: ["account", "share", "publish", "usage", "handle"] },
  { id: "p-image", group: "Pages", label: "Image", hint: "Image studio", href: "/image", icon: <ImagePlus />, keywords: ["photo", "picture", "create"] },
  { id: "p-video", group: "Pages", label: "Video", hint: "Video studio", href: "/video", icon: <Clapperboard />, keywords: ["clip", "film", "create"] },
  { id: "p-director", group: "Pages", label: "Director", hint: "Plan an idea in conversation", href: "/director", icon: <Wand2 />, keywords: ["chat", "plan", "direct"] },
  { id: "p-presets", group: "Pages", label: "Presets", hint: "One photo, one finished clip", href: "/presets", icon: <LayoutGrid />, keywords: ["viral", "effects", "templates"] },
  { id: "p-marketing", group: "Pages", label: "Marketing Agent", hint: "Ads from your product", href: "/marketing", icon: <Megaphone />, keywords: ["ad", "product", "campaign", "advertising", "ugc"] },
  { id: "p-assets", group: "Pages", label: "Assets", hint: "All your results", href: "/assets", icon: <FolderOpen />, keywords: ["results", "downloads", "history", "mine"] },
  { id: "p-credits", group: "Pages", label: "Credits", hint: "Balance and top-up", href: "/credits", icon: <Coins />, keywords: ["cost", "top up", "prices", "buy", "account", "billing"] },
  { id: "p-api", group: "Pages", label: "API & MCP", hint: "Claude, Cursor, CLI", href: "/settings/api", icon: <KeyRound />, keywords: ["key", "agent", "claude", "cli", "mcp"] },
];

const ACTIONS: Item[] = [
  { id: "a-i2v", group: "Actions", label: "Image → Video", hint: "Animate a photo", href: "/video?mode=image", icon: <Sparkles />, keywords: ["animate", "start image"] },
];

/** The palette's contents while it is open: pages, actions, every live model and every preset. */
function useItems(): Item[] {
  const { catalog } = useStudio();
  const presets = usePresets();
  return useMemo(() => {
    const models: Item[] = catalog
      .filter((m) => m.status !== "paused")
      .map((m) => ({
        id: `m-${m.jobType}`,
        group: "Models",
        label: m.model,
        hint: `${m.kind === "image" ? "Image" : "Video"} · ${m.tagline}`,
        href: `/${m.kind}?model=${m.jobType}`,
        icon: m.kind === "image" ? <ImageIcon /> : <Clapperboard />,
        keywords: [m.kind === "image" ? "image" : "video", ...(m.family ? [m.family] : [])],
      }));
    const presetItems: Item[] = presets.map((p) => ({
      id: `pr-${p.id}`,
      group: "Presets",
      label: p.title,
      hint: p.credits != null ? `${p.credits} Credits · ${p.tagline}` : p.tagline,
      href: `/presets/${p.id}`,
      icon: <Flame />,
      keywords: ["preset", "viral"],
    }));
    return [...PAGES, ...ACTIONS, ...models, ...presetItems];
  }, [catalog, presets]);
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const items = useItems();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchCommands(items, query, 40), [items, query]);
  const list = useRef<HTMLUListElement>(null);
  const searching = query.trim().length > 0;

  useEffect(() => setActive(0), [query]);

  // The chosen row stays in view while stepping with the keys.
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // The page underneath does not scroll; focus returns where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  function choose(item: Item | undefined) {
    if (!item) return;
    onClose();
    if (item.href) router.push(item.href);
    else item.run?.();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return createPortal(
    <div className="cmdk" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk__panel" role="dialog" aria-modal="true" aria-label="Search and jump">
        <div className="cmdk__search">
          <Search aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[active] ? `cmdk-${results[active]!.id}` : undefined}
            aria-label="Search"
            placeholder="Search pages, models or presets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="cmdk__list" id="cmdk-list" role="listbox" ref={list} aria-label="Results">
          {results.length === 0 && <li className="cmdk__empty" role="presentation">Nothing found for “{query.trim()}”.</li>}
          {results.map((item, i) => {
            const heading = !searching && (i === 0 || results[i - 1]!.group !== item.group);
            return (
              <li key={item.id} role="presentation">
                {heading && <span className="cmdk__group">{item.group}</span>}
                <div
                  id={`cmdk-${item.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`cmdk__item${i === active ? " is-on" : ""}`}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => choose(item)}
                >
                  {item.icon}
                  <span className="cmdk__label">{item.label}</span>
                  {item.hint && <span className="cmdk__hint">{item.hint}</span>}
                  {searching && <span className="cmdk__tag">{item.group}</span>}
                  <ArrowRight className="cmdk__go" aria-hidden="true" />
                </div>
              </li>
            );
          })}
        </ul>
        <div className="cmdk__foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> select</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
          <span className="cmdk__foot-end"><kbd>⌘</kbd><kbd>K</kbd> anywhere</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Search and jump anywhere (⌘K / Ctrl+K): pages, actions, every live model and every preset. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <Palette onClose={onClose} /> : null;
}

/** Opens the palette with ⌘K or Ctrl+K from anywhere in the studio. */
export function useCommandShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}
