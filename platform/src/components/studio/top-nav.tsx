"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity, ChevronDown, Clapperboard, FolderOpen, ImagePlus, Images, KeyRound, LogOut, Menu as MenuIcon, Receipt,
  LayoutGrid, Megaphone, Search, ShieldCheck, UserRound, Users, Wand2, X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { CommandPalette, useCommandShortcut } from "./command-palette";
import { useCommunity } from "./community";
import { AccountBalance } from "./credits";
import { MegaPanel, type Menu } from "./mega-menu";
import { useStudio } from "./studio-context";
import "./top-nav.css";

function useSignOut() {
  const router = useRouter();
  return async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  };
}

/** Menus open in a portal on <body> under the header bar, so they are never clipped by it. */
function Floating({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}

/**
 * The account menu, laid out like every app's: who is signed in, the balance (the header itself shows no credits),
 * the account's places, sign out. Arrow keys move between the entries, Esc closes and gives the focus back.
 */
function AccountMenu() {
  const { me } = useStudio();
  const { profile, operator } = useCommunity();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<React.CSSProperties>();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  // The menu hangs under the avatar, wherever the bar sits (full width at the top, the pill once the page moves).
  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ top: Math.round(r.bottom + 10), right: Math.max(8, Math.round(document.documentElement.clientWidth - r.right)) });
  }, []);
  useEffect(() => {
    if (!open) return;
    const entries = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    entries()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const list = entries();
      if (list.length === 0) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      list[next]?.focus();
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll);
    };
  }, [open, close, place]);
  const email = me?.email ?? "";
  // With a community profile the menu shows its name and picture.
  const name = profile?.name ?? (email.split("@")[0] || "Account");
  const initial = ([...name][0] ?? "?").toUpperCase();
  // eslint-disable-next-line @next/next/no-img-element
  const face = profile?.avatar ? <img className="hd__avatar-img" src={profile.avatar} alt="" /> : initial;
  const go = () => setOpen(false);
  return (
    <div className="acct" ref={root}>
      <button
        ref={button}
        type="button"
        className="hd__avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account of ${name}`}
        onClick={() => {
          place();
          setOpen((o) => !o);
        }}
      >
        {face}
      </button>
      {open && (
        <Floating>
          <div className="acct__menu" role="menu" aria-label="Account" ref={menu} style={at}>
            <div className="acct__who">
              <span className="acct__avatar" aria-hidden="true">{face}</span>
              <span className="acct__id">
                <span className="acct__name">{name}<span className="tag">Beta</span></span>
                <span className="acct__mail">{email}</span>
              </span>
            </div>
            <AccountBalance onNavigate={go} />
            <div className="acct__group">
              <Link href="/profile" className="acct__item" role="menuitem" onClick={go}><UserRound aria-hidden="true" /> Profile</Link>
              <Link href="/assets" className="acct__item" role="menuitem" onClick={go}><FolderOpen aria-hidden="true" /> My Assets</Link>
              <Link href="/credits" className="acct__item" role="menuitem" onClick={go}><Receipt aria-hidden="true" /> Credits and statement</Link>
              <Link href="/settings/api" className="acct__item" role="menuitem" onClick={go}><KeyRound aria-hidden="true" /> API &amp; MCP</Link>
              {operator && <Link href="/moderation" className="acct__item" role="menuitem" onClick={go}><ShieldCheck aria-hidden="true" /> Moderation</Link>}
              {operator && <Link href="/operations" className="acct__item" role="menuitem" onClick={go}><Activity aria-hidden="true" /> Operations</Link>}
            </div>
            <div className="acct__group acct__group--last">
              <button type="button" className="acct__item" role="menuitem" onClick={signOut}><LogOut aria-hidden="true" /> Sign out</button>
            </div>
          </div>
        </Floating>
      )}
    </div>
  );
}

/** Pages that open on a dark full-bleed picture: at the top the bar lies transparent over it, in light type. */
const HERO_PAGES = new Set(["/presets"]);

const NAV: { href: string; label: string; icon: React.ReactNode; mega?: Menu }[] = [
  { href: "/community", label: "Community", icon: <Users aria-hidden="true" /> },
  { href: "/image", label: "Image", icon: <ImagePlus aria-hidden="true" />, mega: "image" },
  { href: "/video", label: "Video", icon: <Clapperboard aria-hidden="true" />, mega: "video" },
  { href: "/director", label: "Director", icon: <Wand2 aria-hidden="true" /> },
  { href: "/presets", label: "Presets", icon: <LayoutGrid aria-hidden="true" />, mega: "presets" },
  { href: "/marketing", label: "Marketing Agent", icon: <Megaphone aria-hidden="true" /> },
  { href: "/assets", label: "Assets", icon: <Images aria-hidden="true" /> },
];

/** For a visitor without a login (community, a creator's page): sign in, or start free; both come back here. */
function GuestActions({ className = "hd__guest" }: { className?: string }) {
  const pathname = usePathname();
  const back = `/login?next=${encodeURIComponent(pathname)}`;
  return (
    <div className={className}>
      <Link href={back} className="hd__login">Sign in</Link>
      <Link href={back} className="hd__start">Start free</Link>
    </div>
  );
}

/**
 * Small screens: a sheet from the right with every area, search, the balance's way to top up and sign out.
 * Esc, the backdrop and every link close it; the page underneath does not scroll while it is open.
 */
function MenuSheet({ activeHref, onClose, onSearch }: { activeHref?: string; onClose: () => void; onSearch: () => void }) {
  const signOut = useSignOut();
  const { guest } = useStudio();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>(".hd-sheet__close")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return createPortal(
    <div className="hd-sheet" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hd-sheet__panel" id="hd-sheet" role="dialog" aria-modal="true" aria-label="Menu" ref={panel}>
        <div className="hd-sheet__head">
          <Link href="/" className="hd__brand" aria-label="Tevyon, Explore" onClick={onClose}><span className="hd__logo" aria-hidden="true" /></Link>
          <button type="button" className="hd__icon hd-sheet__close" aria-label="Close menu" onClick={onClose}><X aria-hidden="true" /></button>
        </div>
        <button type="button" className="hd-sheet__search" onClick={() => { onClose(); onSearch(); }}><Search aria-hidden="true" /> Search…</button>
        <nav className="hd-sheet__nav" aria-label="Sections">
          <span className="hd-sheet__label">Studio</span>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`hd-sheet__link${n.href === activeHref ? " is-on" : ""}`} aria-current={n.href === activeHref ? "page" : undefined} onClick={onClose}>
              {n.icon}{n.label}
            </Link>
          ))}
          {!guest && (
            <>
              <span className="hd-sheet__label">Account</span>
              <Link href="/profile" className="hd-sheet__link" onClick={onClose}><UserRound aria-hidden="true" />Profile</Link>
            </>
          )}
        </nav>
        <div className="hd-sheet__foot">
          {guest ? (
            <GuestActions className="hd__guest hd__guest--sheet" />
          ) : (
            <>
              <AccountBalance onNavigate={onClose} />
              <div className="hd-sheet__row">
                <Link href="/credits" className="btn" onClick={onClose}>Credits</Link>
                <Link href="/settings/api" className="btn" onClick={onClose}>API &amp; MCP</Link>
                <button type="button" className="btn" onClick={signOut}>Sign out</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The header, a resizable glass bar: at the top it spans the page, once the page moves it draws in to a floating pill.
 * A pill of light glides under the hovered area, a lamp marks the page you are on; search (⌘K) and account on
 * the right. Image, Video and Presets open their menu (mega-menu.tsx) on hover or keyboard focus.
 */
export function TopNav() {
  const pathname = usePathname();
  const { me, guest } = useStudio();
  const [mega, setMega] = useState<Menu | null>(null);
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);
  const [compact, setCompact] = useState(false);
  const [glide, setGlide] = useState<{ x: number; w: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const header = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const links = useRef<Record<string, HTMLAnchorElement | null>>({});

  const openMega = (k: Menu) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMega(k), 120);
  };
  const closeMega = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMega(null), 160);
  };
  const closeNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setMega(null);
  }, []);
  const openPalette = useCallback(() => {
    setMega(null);
    setPalette(true);
  }, []);
  useCommandShortcut(openPalette);

  useEffect(() => {
    setMega(null);
    setSheet(false);
  }, [pathname]);

  // Close the menu on any click outside the header and the menu, on scroll and on Escape.
  useEffect(() => {
    if (!mega) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!header.current?.contains(t) && !panel.current?.contains(t)) setMega(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMega(null);
    const onScroll = () => setMega(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, [mega]);

  // Once the page moves, the bar draws in to a floating pill.
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  const activeHref = NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))?.href;
  const hero = HERO_PAGES.has(pathname) && !compact && !mega;
  const glideTo = (href: string | null) => {
    const el = href ? links.current[href] : null;
    setGlide(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
  };

  return (
    <>
      <header className={`hd${compact ? " is-compact" : ""}${hero ? " is-hero theme-dark" : ""}`} ref={header} onMouseLeave={closeMega}>
        <div className="hd__bar">
          <Link href="/" className="hd__brand" aria-label="Tevyon, Explore">
            <span className="hd__logo" aria-hidden="true" />
          </Link>

          <nav className="hd__nav" aria-label="Sections" onMouseLeave={() => glideTo(null)}>
            <span className={`hd__glide${glide ? " is-on" : ""}`} style={glide ? ({ "--x": `${glide.x}px`, "--w": `${glide.w}px` } as React.CSSProperties) : undefined} aria-hidden="true" />
            {NAV.map((n) => {
              const active = n.href === activeHref;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  ref={(el) => {
                    links.current[n.href] = el;
                  }}
                  className={`hd__link${active ? " is-on" : ""}${n.mega && mega === n.mega ? " is-open" : ""}`}
                  aria-current={active ? "page" : undefined}
                  aria-controls={n.mega ? "hd-mega" : undefined}
                  aria-expanded={n.mega ? mega === n.mega : undefined}
                  onMouseEnter={() => {
                    glideTo(n.href);
                    if (n.mega) openMega(n.mega);
                    else closeMega();
                  }}
                  onFocus={(e) => n.mega && e.currentTarget.matches(":focus-visible") && setMega(n.mega)}
                >
                  {n.label}
                  {n.mega && <ChevronDown className="hd__chev" aria-hidden="true" />}
                  {active && <span className="hd__lamp" aria-hidden="true" />}
                </Link>
              );
            })}
          </nav>

          <div className="hd__tools" onMouseEnter={closeMega}>
            {me?.demo && <span className="hd__note" title="Without model keys, placeholders are generated and nothing is charged.">Demo</span>}
            <button type="button" className="hd__search" onClick={openPalette} aria-label="Search (⌘K)" aria-keyshortcuts="Meta+K Control+K">
              <Search aria-hidden="true" />
              <span className="hd__search-label">Search…</span>
              <kbd>⌘K</kbd>
            </button>
            {guest ? <GuestActions /> : <AccountMenu />}
            <button type="button" className="hd__icon hd__menu" aria-label="Menu" aria-expanded={sheet} aria-controls="hd-sheet" onClick={() => setSheet(true)}>
              <MenuIcon aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <MegaPanel menu={mega} header={header} ref={panel} onEnter={() => timer.current && clearTimeout(timer.current)} onLeave={closeMega} onNavigate={closeNow} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      {sheet && <MenuSheet activeHref={activeHref} onClose={() => setSheet(false)} onSearch={openPalette} />}
    </>
  );
}
