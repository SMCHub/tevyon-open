"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clapperboard, Copy, Expand, Image as ImageIcon, Volume2, VolumeX, X } from "lucide-react";
import { holdLoops } from "./loop-video";
import { readPrefs, soundOf, step, type PreviewEntry, type PreviewMedia, type SoundPrefs } from "./preview";
import { TokenGlyph } from "./tachyon-token";
import "./media-preview.css";

/** Opens the studio-wide preview (preview-host.tsx): own jobs by id (live), or examples, presets, templates, uploads. */
export type Preview = { openJobs: (ids: string[], index?: number) => void; openEntries: (entries: PreviewEntry[], index?: number) => void };

export const PreviewContext = createContext<Preview | null>(null);

export function usePreview() {
  const p = useContext(PreviewContext);
  if (!p) throw new Error("usePreview outside PreviewProvider");
  return p;
}

/** Fields and the video's own controls keep their keys (arrows seek there). */
const ownsKeys = (t: EventTarget | null) => t instanceof Element && t.closest("input, textarea, select, video, [contenteditable]") !== null;

/**
 * The full-screen view every image and video in the studio opens in: media on the stage, details in the side panel,
 * arrows page, Escape or a click beside the media closes. While it is open every other clip on the page pauses,
 * so only the preview is heard; closing resumes them and gives the focus back.
 */
export function MediaPreview({ label, count, index, onIndex, onClose, stage, aside }: {
  label: string; count: number; index: number; onIndex: (i: number) => void; onClose: () => void; stage: React.ReactNode; aside: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.defaultPrevented || ownsKeys(e.target)) return;
      const next = e.key === "ArrowLeft" ? step(index, -1, count) : e.key === "ArrowRight" ? step(index, 1, count) : null;
      if (next !== null) onIndex(next);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, count, onClose, onIndex]);

  useEffect(() => {
    const el = root.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = holdLoops();
    const others = [...document.querySelectorAll("video")].filter((v) => !el.contains(v) && !v.paused);
    others.forEach((v) => v.pause());
    document.body.style.overflow = "hidden";
    el.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = "";
      release();
      others.forEach((v) => v.isConnected && void v.play().catch(() => {}));
      opener?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div ref={root} className="lightbox" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
      <div className="lightbox__backdrop" onClick={onClose} />
      <div className="lightbox__stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {stage}
        {index > 0 && <button type="button" className="lightbox__nav lightbox__nav--prev" aria-label="Vorheriges" onClick={() => onIndex(index - 1)}><ChevronLeft /></button>}
        {index < count - 1 && <button type="button" className="lightbox__nav lightbox__nav--next" aria-label="Nächstes" onClick={() => onIndex(index + 1)}><ChevronRight /></button>}
      </div>
      <aside className="lightbox__side">{aside}</aside>
    </div>
  );
}

/** The media large: a video with sound and controls, or the image. */
export function PreviewStage({ media, alt }: { media: PreviewMedia; alt: string }) {
  return media.kind === "video" ? (
    <PreviewVideo key={media.url} media={media} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={media.url} className="media media--contain" src={media.url} alt={alt} decoding="async" />
  );
}

const PREFS = "tachyon:preview:sound";

function loadPrefs(): SoundPrefs {
  try {
    return readPrefs(localStorage.getItem(PREFS));
  } catch {
    return readPrefs(null);
  }
}

function savePrefs(p: SoundPrefs) {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {}
}

/**
 * A video in the preview, with sound at the viewer's last volume. Where the browser refuses sound without a fresh
 * gesture it plays muted and offers «Ton an»; a clip without an audio track says «Ohne Ton». Space pauses, M mutes.
 */
function PreviewVideo({ media }: { media: PreviewMedia }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [sound, setSound] = useState<boolean | null>(media.audio ?? null);
  // A mute the preview sets itself (blocked sound) is not the viewer's choice and is not remembered.
  const forced = useRef(false);
  const known = useRef(false);

  useEffect(() => {
    const v = ref.current!;
    const prefs = loadPrefs();
    v.volume = prefs.volume;
    v.muted = prefs.muted;
    v.play().catch((e: unknown) => {
      if (!(e instanceof DOMException) || e.name !== "NotAllowedError" || v.muted) return;
      forced.current = true;
      v.muted = true;
      void v.play().catch(() => {});
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || ownsKeys(e.target)) return;
      const t = e.target instanceof Element ? e.target : null;
      const key = e.key.toLowerCase();
      if (key === "m") v.muted = !v.muted;
      if ((key === " " || key === "k") && !t?.closest("button, a")) {
        e.preventDefault();
        if (v.paused) void v.play().catch(() => {});
        else v.pause();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function onVolume() {
    const v = ref.current!;
    setMuted(v.muted);
    if (forced.current) forced.current = false;
    else savePrefs({ muted: v.muted, volume: v.volume });
  }

  // What the file itself says about its sound wins over the job's settings, once the browser knows.
  function probe() {
    if (known.current) return;
    const s = soundOf(ref.current!);
    if (s === null) return;
    known.current = true;
    setSound(s);
  }

  function toggle() {
    const v = ref.current!;
    if (v.muted && v.volume === 0) v.volume = 1;
    v.muted = !v.muted;
  }

  return (
    <>
      <video
        ref={ref}
        className="media media--contain"
        src={media.url}
        poster={media.poster}
        controls
        loop
        playsInline
        preload="auto"
        onVolumeChange={onVolume}
        onLoadedMetadata={probe}
        onTimeUpdate={probe}
      />
      {sound === false ? (
        <span className="pv-sound pv-sound--none" title="Dieses Video hat keine Tonspur."><VolumeX aria-hidden="true" />Ohne Ton</span>
      ) : muted ? (
        <button type="button" className="pv-sound pv-sound--call" onClick={toggle}><Volume2 aria-hidden="true" />Ton an</button>
      ) : sound ? (
        <button type="button" className="pv-sound pv-sound--icon" onClick={toggle} aria-label="Ton ausschalten" title="Ton ausschalten (M)"><Volume2 aria-hidden="true" /></button>
      ) : null}
    </>
  );
}

/** «Kopieren» next to a prompt. */
export function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="lb-copy"
      aria-label="Prompt kopieren"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? "Kopiert" : "Kopieren"}
    </button>
  );
}

/**
 * A prompt in the side panel: its first lines, «Mehr» shows all of it. The panel itself never scrolls for a prompt;
 * only an opened one longer than the free room scrolls inside its own lines.
 */
export function PromptText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);

  useLayoutEffect(() => {
    const p = ref.current;
    if (!p || open) return;
    const measure = () => setLong(p.scrollHeight > p.clientHeight + 1);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(p);
    return () => watch.disconnect();
  }, [text, open]);

  return (
    <>
      <p ref={ref} className={`lb-text${open ? " is-open" : long ? " is-long" : ""}`}>{text}</p>
      {(long || open) && (
        <button type="button" className="lb-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Weniger" : "Mehr"}{open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      )}
    </>
  );
}

/** The keys at the foot of the side panel. */
export function PreviewHint({ video }: { video: boolean }) {
  return (
    <p className="lightbox__hint">
      <kbd>←</kbd><kbd>→</kbd> blättern {video && <><kbd>M</kbd> Ton </>}<kbd>Esc</kbd> schliessen
    </p>
  );
}

/** Side panel of an example, preset, template or upload: what it is, its prompt to copy, and its main step. */
export function EntryAside({ entry, onClose, onAction }: { entry: PreviewEntry; onClose: () => void; onAction: () => void }) {
  const a = entry.action;
  return (
    <>
      <header className="lb-head">
        <span className="lb-chip">{entry.kind === "video" ? <Clapperboard aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}{entry.chip}</span>
        <button type="button" className="icon-btn lb-close" aria-label="Schliessen" onClick={onClose}><X /></button>
      </header>
      <h2 className="lightbox__model">{entry.title}</h2>
      {entry.text && <p className="pv-text">{entry.text}</p>}
      {entry.prompt && (
        <section className="lb-prompt">
          <div className="lb-label">Prompt <CopyPrompt text={entry.prompt} /></div>
          <PromptText key={entry.url} text={entry.prompt} />
        </section>
      )}
      {entry.facts && entry.facts.length > 0 && (
        <section>
          <div className="lb-label">Details</div>
          <ul className="lb-facts">
            {entry.facts.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </section>
      )}
      <div className="lb-actions">
        {a && (
          <button type="button" className="btn btn--primary lb-actions__main" onClick={onAction} disabled={a.disabled}>
            <span className="lb-actions__label">{a.label}</span>
            {a.credits != null && <span className="go__price"><TokenGlyph />{a.credits}</span>}
          </button>
        )}
        {entry.extra}
        <PreviewHint video={entry.kind === "video"} />
      </div>
    </>
  );
}

/** Small glass button on a tile that opens its preview; the tile's own click keeps doing what it did. */
export function PreviewButton({ onOpen, className = "" }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={`icon-btn pv-open${className ? ` ${className}` : ""}`}
      aria-label="Vorschau"
      title="Vorschau"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.stopPropagation()}
    >
      <Expand aria-hidden="true" />
    </button>
  );
}
