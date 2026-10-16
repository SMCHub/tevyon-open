"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight, Clapperboard, Coins, FolderOpen, Image as ImageIcon, ImagePlus, KeyRound, Search, Sparkles, UserRound, Users, Wand2,
} from "lucide-react";
import { searchCommands, type Command } from "./command-search";
import { useStudio } from "./studio-context";
import "./command-palette.css";

type Item = Command & { icon: React.ReactNode; href?: string; run?: () => void };

const PAGES: Item[] = [
  { id: "p-community", group: "Seiten", label: "Community", hint: "Was andere teilen", href: "/community", icon: <Users />, keywords: ["geteilt", "öffentlich", "galerie", "feed", "andere"] },
  { id: "p-profile", group: "Seiten", label: "Profil", hint: "Nutzung, Kreationen, teilen", href: "/profile", icon: <UserRound />, keywords: ["konto", "account", "teilen", "veröffentlichen", "nutzung", "handle"] },
  { id: "p-image", group: "Seiten", label: "Bild", hint: "Bild-Studio", href: "/image", icon: <ImagePlus />, keywords: ["foto", "image", "erstellen"] },
  { id: "p-video", group: "Seiten", label: "Video", hint: "Video-Studio", href: "/video", icon: <Clapperboard />, keywords: ["clip", "film", "erstellen"] },
  { id: "p-director", group: "Seiten", label: "Director", hint: "Idee im Gespräch planen", href: "/director", icon: <Wand2 />, keywords: ["chat", "planen", "regie"] },
  { id: "p-assets", group: "Seiten", label: "Assets", hint: "Alle deine Ergebnisse", href: "/assets", icon: <FolderOpen />, keywords: ["ergebnisse", "downloads", "verlauf", "meine"] },
  { id: "p-credits", group: "Seiten", label: "Credits", hint: "Saldo und Aufladen", href: "/credits", icon: <Coins />, keywords: ["kosten", "aufladen", "preise", "kaufen", "konto"] },
  { id: "p-api", group: "Seiten", label: "API & MCP", hint: "Claude, Cursor, CLI", href: "/settings/api", icon: <KeyRound />, keywords: ["schlüssel", "agent", "claude", "cli", "mcp"] },
];

const ACTIONS: Item[] = [
  { id: "a-i2v", group: "Aktionen", label: "Bild → Video", hint: "Foto animieren", href: "/video?mode=image", icon: <Sparkles />, keywords: ["animieren", "startbild"] },
];

/** The palette's contents while it is open: pages, actions and every live model. */
function useItems(): Item[] {
  const { catalog } = useStudio();
  return useMemo(() => {
    const models: Item[] = catalog
      .filter((m) => m.status !== "paused")
      .map((m) => ({
        id: `m-${m.jobType}`,
        group: "Modelle",
        label: m.model,
        hint: `${m.kind === "image" ? "Bild" : "Video"} · ${m.tagline}`,
        href: `/${m.kind}?model=${m.jobType}`,
        icon: m.kind === "image" ? <ImageIcon /> : <Clapperboard />,
        keywords: [m.kind === "image" ? "bild" : "video", ...(m.family ? [m.family] : [])],
      }));
    return [...PAGES, ...ACTIONS, ...models];
  }, [catalog]);
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
      <div className="cmdk__panel" role="dialog" aria-modal="true" aria-label="Suchen und springen">
        <div className="cmdk__search">
          <Search aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[active] ? `cmdk-${results[active]!.id}` : undefined}
            aria-label="Suchen"
            placeholder="Seite oder Modell suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="cmdk__list" id="cmdk-list" role="listbox" ref={list} aria-label="Treffer">
          {results.length === 0 && <li className="cmdk__empty" role="presentation">Nichts gefunden für «{query.trim()}».</li>}
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
          <span><kbd>↑</kbd><kbd>↓</kbd> wählen</span>
          <span><kbd>↵</kbd> öffnen</span>
          <span><kbd>Esc</kbd> schliessen</span>
          <span className="cmdk__foot-end"><kbd>⌘</kbd><kbd>K</kbd> überall</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Search and jump anywhere (⌘K / Ctrl+K): pages, actions and every live model. */
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
