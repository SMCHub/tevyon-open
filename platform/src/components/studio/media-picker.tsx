"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ShieldCheck, Upload, X } from "lucide-react";
import { useStudio } from "./studio-context";
import "./media-picker.css";

type Kind = "image" | "video";
type Item = { key: string; url: string; kind: Kind; jobId?: string };
type Tab = "uploads" | "results";

const ACCEPT: Record<Kind, string> = { image: "image/png,image/jpeg,image/webp", video: "video/mp4,video/quicktime" };
const WIDTH = 372;
const GAP = 12;

// Earlier uploads, kept between openings so the grid shows at once and refreshes behind it; per account, so after a
// change of login nobody sees the previous account's list.
let cachedUploads: { owner: string; items: Item[] } | null = null;

async function loadUploads(): Promise<Item[]> {
  const r = await fetch("/api/uploads", { cache: "no-store" }).catch(() => undefined);
  const res = (await r?.json().catch(() => undefined)) as { ok: boolean; uploads?: { url: string; kind: Kind }[] } | undefined;
  return (res?.uploads ?? []).map((u) => ({ key: u.url, url: u.url, kind: u.kind }));
}

/** One of the account's results as an upload of its own (/api/uploads/from-job), so it passes as an input. */
async function resultAsUpload(jobId: string): Promise<string | null> {
  const r = await fetch("/api/uploads/from-job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, index: 0 }) }).catch(() => undefined);
  const res = (await r?.json().catch(() => undefined)) as { ok: boolean; url?: string } | undefined;
  return res?.ok && res.url ? res.url : null;
}

/**
 * Where the card goes: in a side panel right beside the panel (its neighbour on the stage), else above or below the
 * trigger (the composer sits at the bottom, so its card opens upwards). Phones get a sheet at the bottom.
 */
function place(anchor: HTMLElement, height: number): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < 640) return { left: 8, right: 8, bottom: 8, width: "auto" };
  const at = anchor.getBoundingClientRect();
  const panel = anchor.closest(".panel")?.getBoundingClientRect();
  const top = Math.max(GAP, Math.min(at.top, vh - height - GAP));
  if (panel && panel.right + GAP + WIDTH <= vw - GAP) return { left: panel.right + GAP, top };
  const left = Math.max(GAP, Math.min(at.left, vw - WIDTH - GAP));
  return at.top > vh / 2 ? { left, top: Math.max(GAP, at.top - height - 8) } : { left, top: Math.min(at.bottom + 8, vh - height - GAP) };
}

/**
 * Instead of the file dialog, every upload field opens this card beside it: earlier uploads and own results (“Assets”, as the page is called) to pick again,
 * and “From computer” for a new file. Every new file is scanned on the server before it is stored (upload-scan.ts).
 * `onFiles` gets new files (the page uploads them as before), `onPick` the URLs of picked uploads or results.
 */
export function useMediaPicker({ kind, multiple = false, max = 1, onPick, onFiles }: {
  kind: Kind; multiple?: boolean; max?: number; onPick: (urls: string[]) => void; onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Without a trigger element (keyboard shortcuts, older call sites) it falls back to the plain file dialog.
  const open = useCallback((el?: HTMLElement | null) => {
    if (!el) return void input.current?.click();
    anchorRef.current = el;
    setAnchor(el);
  }, []);
  const close = useCallback(() => {
    const a = anchorRef.current;
    anchorRef.current = null;
    setAnchor(null);
    a?.focus();
  }, []);
  const el = (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT[kind]}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) {
            close();
            onFiles(files);
          }
        }}
      />
      {anchor && (
        <PickerCard
          anchor={anchor}
          kind={kind}
          multiple={multiple}
          max={max}
          onClose={close}
          onComputer={() => input.current?.click()}
          onDropFiles={(files) => {
            close();
            onFiles(files);
          }}
          onPick={(urls) => {
            close();
            onPick(urls);
          }}
        />
      )}
    </>
  );
  return { open, el, isOpen: anchor !== null };
}

function PickerCard({ anchor, kind, multiple, max, onClose, onComputer, onDropFiles, onPick }: {
  anchor: HTMLElement; kind: Kind; multiple: boolean; max: number;
  onClose: () => void; onComputer: () => void; onDropFiles: (files: File[]) => void; onPick: (urls: string[]) => void;
}) {
  const { jobs, kindOf, me } = useStudio();
  const owner = me?.email ?? "";
  const card = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [uploads, setUploads] = useState<Item[] | null>(cachedUploads?.owner === owner ? cachedUploads.items : null);
  const [tab, setTab] = useState<Tab>("uploads");
  const [chosen, setChosen] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  // Files that do not load (e.g. a result whose file is missing) are left out instead of showing a broken tile.
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const hide = (key: string) => setBroken((b) => new Set(b).add(key));

  useEffect(() => {
    let live = true;
    void loadUploads().then((list) => {
      cachedUploads = { owner, items: list };
      if (live) setUploads(list);
    });
    return () => {
      live = false;
    };
  }, [owner]);

  const results = useMemo<Item[]>(
    () => jobs
      .filter((j) => j.status === "succeeded" && kindOf(j.jobType) === kind && j.outputs[0])
      .map((j) => ({ key: j.id, url: j.outputs[0]!.url, kind, jobId: j.id })),
    [jobs, kindOf, kind],
  );
  const shownUploads = (uploads ?? []).filter((u) => u.kind === kind && !broken.has(u.key));
  const shownResults = results.filter((r) => !broken.has(r.key));
  const items = tab === "uploads" ? shownUploads : shownResults;

  // Placed after the first paint (its height is known then) and again when the window changes.
  useLayoutEffect(() => {
    const update = () => setStyle(place(anchor, card.current?.offsetHeight ?? 480));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, items.length]);

  // Esc and a click outside close it; focus starts in the card.
  useEffect(() => {
    card.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!card.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", down);
    };
  }, [anchor, onClose]);

  async function finish(list: Item[]) {
    setBusy(true);
    setError(null);
    const urls = await Promise.all(list.map((i) => (i.jobId ? resultAsUpload(i.jobId) : Promise.resolve(i.url))));
    setBusy(false);
    const ok = urls.filter((u): u is string => Boolean(u));
    if (ok.length < list.length) setError("An asset couldn't be added just now.");
    if (ok.length) onPick(ok);
  }

  function choose(item: Item) {
    if (busy) return;
    if (!multiple) return void finish([item]);
    setChosen((c) => (c.some((x) => x.key === item.key) ? c.filter((x) => x.key !== item.key) : c.length < max ? [...c, item] : c));
  }

  const noun = kind === "video" ? "video" : multiple ? "images" : "image";
  return createPortal(
    <div
      ref={card}
      className={`mpk${drag ? " is-drag" : ""}`}
      style={style}
      role="dialog"
      aria-label={`Add ${noun}`}
      // Portalled, but React events still bubble to the field that opened it (a drop zone, the composer): stop them here.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        e.stopPropagation();
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        if (!card.current?.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith(`${kind}/`));
        if (files.length) onDropFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <header className="mpk__head">
        <p className="mpk__title">Add {noun}</p>
        <button type="button" className="icon-btn mpk__x" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></button>
      </header>

      <button type="button" className="mpk__computer" onClick={onComputer} data-autofocus>
        <span className="mpk__computer-icon" aria-hidden="true"><Upload /></span>
        <span className="mpk__computer-text">
          <span className="mpk__computer-title">From computer</span>
          <span className="mpk__computer-sub">{kind === "video" ? "MP4 or MOV, 4 to 30 seconds" : "JPG, PNG or WebP"}, or drag here</span>
        </span>
      </button>

      <div className="mpk__tabs" role="tablist" aria-label="Source">
        {([["uploads", "Uploads", shownUploads.length], ["results", "Assets", shownResults.length]] as const).map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="mpk__tab" onClick={() => setTab(id)}>
            {label} <span className="mpk__n">{n}</span>
          </button>
        ))}
      </div>

      <div className="mpk__body">
        {tab === "uploads" && uploads === null ? (
          <p className="mpk__empty"><span className="ring" aria-hidden="true" /> Loading …</p>
        ) : items.length === 0 ? (
          <p className="mpk__empty">{tab === "uploads" ? `No ${kind === "video" ? "videos" : "images"} uploaded yet.` : `No ${kind === "video" ? "videos" : "images"} created yet.`}</p>
        ) : (
          <ul className="mpk__grid" role="listbox" aria-multiselectable={multiple} aria-label={tab === "uploads" ? "Your uploads" : "Your Assets"}>
            {items.map((item) => {
              const at = chosen.findIndex((c) => c.key === item.key);
              return (
                <li key={item.key} role="option" aria-selected={at >= 0}>
                  <button type="button" className={`mpk__item${at >= 0 ? " is-on" : ""}`} onClick={() => choose(item)} disabled={busy} aria-label={`Use ${kind === "video" ? "video" : "image"}`}>
                    {item.kind === "video"
                      ? <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" onError={() => hide(item.key)} />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={item.url} alt="" loading="lazy" decoding="async" onError={() => hide(item.key)} />}
                    {at >= 0 && <span className="mpk__mark" aria-hidden="true">{multiple ? at + 1 : <Check />}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <p className="mpk__error" role="alert">{error}</p>}
      <footer className="mpk__foot">
        <span className="mpk__note"><ShieldCheck aria-hidden="true" /> Every new upload is checked automatically</span>
        {multiple && (
          <button type="button" className="btn mpk__go" disabled={chosen.length === 0 || busy} onClick={() => void finish(chosen)}>
            {busy ? "Adding …" : `Insert${chosen.length ? ` (${chosen.length})` : ""}`}
          </button>
        )}
        {!multiple && busy && <span className="mpk__note"><span className="ring" aria-hidden="true" /> Adding …</span>}
      </footer>
    </div>,
    document.body,
  );
}
