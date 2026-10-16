"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Images, X } from "lucide-react";
import { useMediaPicker } from "./media-picker";
import { uploadImage } from "./upload";
import "./mention-mirror.css";

/** The token a reference gets in the prompt; the server turns "@image2" into "image 2" for the model. */
export const mentionOf = (n: number) => `@image${n}`;

const MENTION = /@(?:bild|image|img|ref)\s?(\d{1,2})\b/giu;

/** After removing reference `n`, drop its mentions and move the later ones up by one. */
export function renumberAfterRemoval(prompt: string, n: number): string {
  return prompt
    .replace(MENTION, (m, d: string) => {
      const k = Number(d);
      if (k === n) return "";
      return k > n ? mentionOf(k - 1) : m;
    })
    .replace(/ {2,}/g, " ");
}

/** The @-mentions in the prompt without an attached image, e.g. "@image3" with two references (the server refuses those). */
export function unattachedMentions(prompt: string, attached: number): string[] {
  const named = new Set([...prompt.matchAll(MENTION)].map((m) => Number(m[1])));
  return [...named].filter((n) => n < 1 || n > attached).sort((a, b) => a - b).map(mentionOf);
}

/** A piece of the prompt: plain text, or a mention of reference `n` (attached: its image is there). */
export type MentionPart = { text: string; n?: number; attached?: boolean };

/** The prompt split into text and @-mentions, in order; joined, the pieces give the prompt back unchanged. */
export function mentionParts(text: string, attached: number): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at) });
    const n = Number(m[1]);
    parts.push({ text: m[0], n, attached: n >= 1 && n <= attached });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** What the mirror copies from its textarea, so both lay the text out alike. */
const MIRRORED = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "letterSpacing", "wordSpacing", "lineHeight", "textTransform", "textIndent",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
] as const;

/**
 * The prompt's @-mentions marked in place: a mirror
 * of the text behind the textarea, laid out with the textarea's own font, padding and width, every "@imageN" as a
 * framed mark and one without its image dashed. The text, the caret and the selection stay the textarea's. Put both
 * in a `.mention-field`, the mirror after the textarea (React sets the textarea's ref before the mirror's layout effect
 * only in that order; the stacking comes from mention-mirror.css).
 */
export function MentionMirror({ text, attached, target }: { text: string; attached: number; target: React.RefObject<HTMLTextAreaElement | null> }) {
  const mirror = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = target.current;
    const m = mirror.current;
    if (!el || !m) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      for (const k of MIRRORED) m.style[k] = cs[k];
      // The box inside the textarea's border and without its scrollbar, so the lines break at the same words.
      m.style.top = cs.borderTopWidth;
      m.style.left = cs.borderLeftWidth;
      m.style.width = `${el.clientWidth}px`;
      m.style.height = `${el.clientHeight}px`;
      m.scrollTop = el.scrollTop;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const follow = () => {
      m.scrollTop = el.scrollTop;
    };
    el.addEventListener("scroll", follow);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", follow);
    };
  }, [target]);
  // A new line can make the textarea scroll without a scroll event of its own.
  useLayoutEffect(() => {
    const el = target.current;
    const m = mirror.current;
    if (el && m) m.scrollTop = el.scrollTop;
  }, [text, target]);
  return (
    <div ref={mirror} className="mention-mirror" aria-hidden="true">
      {mentionParts(text, attached).map((p, i) =>
        p.n ? <mark key={i} className={`mention-mark${p.attached ? "" : " is-loose"}`}>{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
      {/* Keeps a last empty line, as the textarea has after a line break. */}
      {"\u200b"}
    </div>
  );
}

type Pending = { id: string; preview: string };

/**
 * Reference images of a generator: uploads (in parallel, in the order chosen), their URLs in the draft's
 * `references` option, and the mentions in the prompt kept in step when one is removed.
 */
export function useReferences({ urls, max, setUrls, prompt, setPrompt }: {
  urls: string[];
  max: number;
  setUrls: (next: (prev: string[]) => string[]) => void;
  prompt: string;
  setPrompt: (p: string) => void;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const free = Math.max(0, max - urls.length - pending.length);

  async function add(files: File[]) {
    setError(null);
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    const take = images.slice(0, free);
    if (take.length < images.length) setError(`This model takes at most ${max} reference images.`);
    const jobs = take.map((file) => ({ id: crypto.randomUUID(), preview: URL.createObjectURL(file), file }));
    setPending((p) => [...p, ...jobs.map(({ id, preview }) => ({ id, preview }))]);
    // Upload in parallel, append in the order the user picked them.
    const results = await Promise.all(jobs.map((j) => uploadImage(j.file)));
    setPending((p) => p.filter((x) => !jobs.some((j) => j.id === x.id)));
    jobs.forEach((j) => URL.revokeObjectURL(j.preview));
    const ok = results.flatMap((r) => ("url" in r ? [r.url] : []));
    const failed = results.find((r): r is { error: string } => "error" in r);
    if (failed) setError(failed.error);
    if (ok.length) setUrls((prev) => [...prev, ...ok].slice(0, max));
  }

  /** Earlier uploads or results picked again: appended in the order picked, as far as there is room. */
  function addUrls(picked: string[]) {
    setError(null);
    if (picked.length > free) setError(`This model takes at most ${max} reference images.`);
    setUrls((prev) => [...prev, ...picked.filter((u) => !prev.includes(u))].slice(0, max));
  }

  function remove(index: number) {
    setUrls((prev) => prev.filter((_, i) => i !== index));
    setPrompt(renumberAfterRemoval(prompt, index + 1));
  }

  return { urls, pending, error, free, max, add, addUrls, remove };
}

/** Thumbnails above the prompt, each with its @-name and a remove button. */
export function RefStrip({ refs, onMention }: { refs: ReturnType<typeof useReferences>; onMention: (n: number) => void }) {
  if (refs.urls.length === 0 && refs.pending.length === 0 && !refs.error) return null;
  return (
    <div className="refs" aria-label="Reference images">
      {refs.urls.map((url, i) => (
        <figure key={url} className="ref">
          <button type="button" className="ref__img" onClick={() => onMention(i + 1)} title={`Insert ${mentionOf(i + 1)} into the prompt`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Reference image ${i + 1}`} />
          </button>
          <figcaption className="ref__tag">{mentionOf(i + 1)}</figcaption>
          <button type="button" className="ref__x" aria-label={`Remove reference image ${i + 1}`} onClick={() => refs.remove(i)}><X /></button>
        </figure>
      ))}
      {refs.pending.map((p) => (
        <figure key={p.id} className="ref ref--busy" aria-label="Uploading">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="ref__img"><img src={p.preview} alt="" /></span>
          <span className="ring" aria-hidden="true" />
        </figure>
      ))}
      {refs.error && <p className="refs__error" role="alert">{refs.error}</p>}
    </div>
  );
}

/**
 * The @-menu: pick a reference to mention, filtered by what follows the @. `onBrowse` adds a last row that opens the
 * assets (earlier uploads and results) and mentions what is picked there; `note` replaces it when nothing can be added.
 */
export function MentionMenu({ urls, query, active, onPick, onBrowse, note }: { urls: string[]; query: string; active: number; onPick: (n: number) => void; onBrowse?: () => void; note?: string }) {
  const items = urls.map((url, i) => ({ url, n: i + 1 })).filter(({ n }) => !query || String(n).startsWith(query.replace(/\D/g, "")) || mentionOf(n).toLowerCase().startsWith(`@${query.toLowerCase()}`));
  return (
    <div className="mention" role="listbox" aria-label="Mention reference image">
      {items.map(({ url, n }, i) => (
        <button
          key={url}
          type="button"
          role="option"
          aria-selected={i === active}
          className="mention__item"
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(n);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" />
          <span>{mentionOf(n)}</span>
        </button>
      ))}
      {onBrowse ? (
        <button
          type="button"
          role="option"
          aria-selected={active === items.length}
          className="mention__item mention__item--browse"
          onMouseDown={(e) => {
            e.preventDefault();
            onBrowse();
          }}
        >
          <span className="mention__icon" aria-hidden="true"><Images /></span>
          <span>Choose from Assets…</span>
        </button>
      ) : items.length === 0 ? (
        <p className="mention__empty">{note ?? "Add an image with + first, then refer to it with @."}</p>
      ) : null}
    </div>
  );
}

/**
 * The @-word from `start` to `end` replaced by the names of references `ns` (picked from the assets while typing it),
 * with the caret right after them; no double space when text follows.
 */
export function replaceMention(text: string, start: number, end: number, ns: number[]): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const names = lead + ns.map(mentionOf).join(" ");
  const tail = /^\s/.test(after) ? "" : " ";
  return { text: before + names + tail + after, caret: (before + names).length + (tail ? 1 : 0) };
}

/** The "@query" right before the caret, if the user is typing a mention. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([\p{L}\d]*)$/u.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null;
}

/**
 * The picker for reference images: `open(trigger)` shows earlier uploads and results beside the trigger (several at
 * once, as many as there is room for), or a new file from the computer. `open()` alone opens the file dialog.
 */
export function useRefPicker(refs: ReturnType<typeof useReferences>) {
  return useMediaPicker({ kind: "image", multiple: true, max: Math.max(1, refs.free), onPick: refs.addUrls, onFiles: (files) => void refs.add(files) });
}

/** Event the image composer listens to: a reference image to add (url of an upload of ours). */
export const ADD_REF_EVENT = "tachyon:add-reference";

/** Copies a finished image of the account into its uploads and hands it to the image composer. */
export async function jobAsReference(jobId: string, go: (href: string) => void): Promise<string | null> {
  const r = await fetch("/api/uploads/from-job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, index: 0 }) }).catch(() => undefined);
  const res = (await r?.json().catch(() => undefined)) as { ok: boolean; url?: string } | undefined;
  if (!res?.ok || !res.url) return "This image cannot be used as a reference right now.";
  if (window.location.pathname === "/image") window.dispatchEvent(new CustomEvent(ADD_REF_EVENT, { detail: res.url }));
  else go(`/image?ref=${encodeURIComponent(res.url)}`);
  return null;
}
