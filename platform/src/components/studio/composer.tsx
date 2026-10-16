"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, ImagePlus, Minus, Plus, TriangleAlert } from "lucide-react";
import { NotEnough, priceText, startErrorText } from "./credits";
import { TokenGlyph } from "./tachyon-token";
import { ModelPicker, useDraft } from "./draft";
import { OptionPills } from "./options";
import { ADD_REF_EVENT, mentionAt, MentionMenu, MentionMirror, mentionOf, RefStrip, replaceMention, unattachedMentions, useReferences, useRefPicker } from "./references";
import { useStudio } from "./studio-context";

/** Floating prompt bar of the image studio. */
export function Composer() {
  const { me, start } = useStudio();
  const d = useDraft("image");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [drag, setDrag] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  // Reference images: only models whose schema takes them (and only as many as they take).
  const refSchema = d.model?.params.properties?.references as { maxItems?: number } | undefined;
  const maxRefs = refSchema?.maxItems ?? 0;
  const urls = Array.isArray(d.opts.references) ? (d.opts.references as string[]) : [];
  // Uploads finish later: they must append to the list as it is then, not as it was when they started.
  const latest = useRef(urls);
  latest.current = urls;
  const refs = useReferences({
    urls, max: maxRefs, prompt: d.prompt, setPrompt: d.setPrompt,
    setUrls: (next) => d.setOpt("references", next(latest.current)),
  });
  const picker = useRefPicker(refs);

  // «Aus Assets wählen …» in the @-menu: the picker opens, and the images picked there (or uploaded from the computer)
  // replace the @-word being typed with their names once they are attached.
  const browsing = useRef<{ start: number; end: number; count: number } | null>(null);
  function browse(at?: { start: number; end: number }) {
    const el = area.current;
    const target = at ?? (mention ? { start: mention.start, end: el?.selectionStart ?? d.prompt.length } : null);
    if (!el || !target) return;
    browsing.current = { ...target, count: urls.length };
    setMention(null);
    // Next frame: opened inside this mousedown, the picker would take it for a click outside and close at once.
    requestAnimationFrame(() => picker.open(el));
  }
  useEffect(() => {
    const b = browsing.current;
    if (!b) return;
    if (urls.length > b.count) {
      browsing.current = null;
      const ns = Array.from({ length: urls.length - b.count }, (_, i) => b.count + i + 1);
      const next = replaceMention(d.prompt, b.start, b.end, ns);
      d.setPrompt(next.text);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(next.caret, next.caret);
      });
    }
    // The picker closes before the picked image is attached, so closing alone does not end it: typing does.
  }, [urls.length, d]);
  const canBrowse = maxRefs > 0 && refs.free > 0;

  // «Als Referenz verwenden» on a result while on this page (from elsewhere, ?ref= seeds the draft): add it here,
  // switching to a model that takes references if needed.
  const pendingRef = useRef<string | null>(null);
  useEffect(() => {
    const take = (url: string) => {
      pendingRef.current = url;
      setTick((t) => t + 1);
    };
    const onEvent = (e: Event) => take((e as CustomEvent<string>).detail);
    window.addEventListener(ADD_REF_EVENT, onEvent);
    return () => window.removeEventListener(ADD_REF_EVENT, onEvent);
  }, []);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const url = pendingRef.current;
    if (!url || !d.model) return;
    if (!maxRefs) {
      const able = d.models.find((m) => (m.params.properties?.references as { maxItems?: number } | undefined)?.maxItems);
      if (able) d.chooseModel(able);
      return; // runs again once the model has switched
    }
    pendingRef.current = null;
    if (!latest.current.includes(url) && latest.current.length < maxRefs) d.setOpt("references", [...latest.current, url]);
  }, [tick, d, maxRefs]);

  /** Puts «@BildN» at the caret (or replaces the @-word being typed) and keeps the caret after it. */
  function insertMention(n: number) {
    const el = area.current;
    const text = d.prompt;
    const caret = el?.selectionStart ?? text.length;
    const from = mention?.start ?? caret;
    const before = text.slice(0, from);
    const token = `${before && !/\s$/.test(before) ? " " : ""}${mentionOf(n)} `;
    const next = before + token + text.slice(caret);
    d.setPrompt(next);
    setMention(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = (before + token).length;
      el?.setSelectionRange(pos, pos);
    });
  }

  /** The @ button: start a mention at the caret so the menu opens. */
  function startMention() {
    const el = area.current;
    const text = d.prompt;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const at = `${before && !/\s$/.test(before) ? " " : ""}@`;
    d.setPrompt(before + at + text.slice(caret));
    // Nothing attached yet: straight to the assets, no menu first.
    if (urls.length === 0 && canBrowse) {
      const pos = before.length + at.length;
      browse({ start: pos - 1, end: pos });
      return;
    }
    setMention({ start: before.length + at.length - 1, query: "" });
    setActive(0);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = before.length + at.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  // Grow the prompt field with its content (up to a limit set in CSS).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [d.prompt]);

  const tooExpensive = me !== null && d.total !== null && d.total > me.credits;
  // Every image the prompt names goes along: wait for uploads, and refuse «@Bild3» without a third image.
  const uploading = refs.pending.length > 0;
  const missing = mention ? [] : unattachedMentions(d.prompt, urls.length);
  const canGo = Boolean(d.model && d.prompt.trim() && !busy && !tooExpensive && !uploading && missing.length === 0);
  const holdText = uploading
    ? "Referenzbild wird noch hochgeladen …"
    : missing.length
      ? maxRefs
        ? `${missing.join(", ")} ${missing.length === 1 ? "ist" : "sind"} nicht angehängt. Füge das Bild hinzu oder nimm den Verweis aus dem Prompt.`
        // A model without references cannot take the image at all: only the prompt or the model can change.
        : `${d.model?.model ?? "Dieses Modell"} nimmt keine Referenzbilder. Nimm ${missing.join(", ")} aus dem Prompt oder wähle ein Modell mit Referenzbildern.`
      : null;

  async function generate() {
    if (!canGo || !d.model) return;
    setBusy(true);
    setError(null);
    // The price on the button is the price per job the user agreed to; a higher server price starts nothing.
    const res = await start(d.model.jobType, d.params, d.count, d.price !== null ? { maxCredits: d.price } : {});
    setBusy(false);
    if (!res.ok) {
      if (res.error === "price_changed") d.requote();
      setError(startErrorText(res, d.count));
    }
  }

  return (
    <div className="composer" role="region" aria-label="Bild erstellen">
      {error ? <p className="composer__alert" role="alert"><TriangleAlert aria-hidden="true" />{error}</p>
        : holdText && d.prompt.trim() ? <p className="composer__alert" role="status"><TriangleAlert aria-hidden="true" />{holdText}</p>
        : tooExpensive && <NotEnough need={d.total ?? 0} have={me?.credits ?? 0} className="short--composer" />}
      <div
        className={`composer__box${drag ? " is-drag" : ""}`}
        onDragOver={(e) => {
          if (!maxRefs || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrag(false)}
        onDrop={(e) => {
          if (!maxRefs) return;
          e.preventDefault();
          setDrag(false);
          void refs.add([...e.dataTransfer.files]);
        }}
      >
        {picker.el}
        <RefStrip refs={refs} onMention={insertMention} />
        {mention && (
          <MentionMenu
            urls={urls}
            query={mention.query}
            active={active}
            onPick={insertMention}
            onBrowse={canBrowse ? browse : undefined}
            note={!maxRefs ? `${d.model?.model ?? "Dieses Modell"} nimmt keine Referenzbilder.` : undefined}
          />
        )}
        <div className="mention-field">
        <textarea
          ref={area}
          className="composer__prompt"
          rows={1}
          value={d.prompt}
          onChange={(e) => {
            browsing.current = null;
            d.setPrompt(e.target.value);
            const m = mentionAt(e.target.value, e.target.selectionStart);
            // A fresh @ with nothing attached opens the assets right away instead of a menu with one row.
            if (m && m.query === "" && urls.length === 0 && canBrowse) {
              setMention(null);
              browse({ start: m.start, end: e.target.selectionStart });
              return;
            }
            // A finished name («@Bild2») closes the menu, so Enter generates again.
            const done = m && urls.some((_, i) => mentionOf(i + 1).slice(1).toLowerCase() === m.query.toLowerCase());
            setMention(done ? null : m);
            if (m) setActive(0);
          }}
          onBlur={() => setMention(null)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (!maxRefs || files.length === 0) return;
            e.preventDefault();
            void refs.add(files);
          }}
          placeholder="Beschreibe das Bild, das du dir vorstellst …"
          aria-label="Prompt"
          onKeyDown={(e) => {
            // The menu's rows: the attached references, then «Aus Assets wählen …» when more fit.
            const rows = urls.length + (canBrowse ? 1 : 0);
            if (mention && rows > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a + (e.key === "ArrowDown" ? 1 : rows - 1)) % rows);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (active < urls.length) insertMention(active + 1);
                else browse();
                return;
              }
            }
            if (e.key === "Escape" && mention) {
              setMention(null);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              generate();
            }
          }}
        />
        {/* After the textarea: its ref is set before the mirror measures it. */}
        <MentionMirror text={d.prompt} attached={urls.length} target={area} />
        </div>
        <div className="composer__bar">
          <div className="composer__tools">
            <span className="pill-group" aria-label="Referenzen">
              <button
                type="button"
                className="pill-btn pill-btn--icon"
                disabled={!maxRefs || refs.free === 0}
                onClick={(e) => picker.open(e.currentTarget)}
                aria-haspopup="dialog"
                aria-expanded={picker.isOpen}
                title={!maxRefs ? `${d.model?.model ?? "Dieses Modell"} nimmt keine Referenzbilder` : refs.free === 0 ? `Höchstens ${maxRefs} Referenzbilder` : "Referenzbilder hinzufügen (auch per Ziehen oder Einfügen)"}
                aria-label="Referenzbild hinzufügen"
              >
                <ImagePlus />
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--icon"
                disabled={urls.length === 0 && !canBrowse}
                onMouseDown={(e) => e.preventDefault()}
                onClick={startMention}
                title={urls.length ? "Referenzbild im Prompt erwähnen" : canBrowse ? "Bild aus deinen Assets erwähnen" : `${d.model?.model ?? "Dieses Modell"} nimmt keine Referenzbilder`}
                aria-label="Referenzbild erwähnen"
              >
                <AtSign />
              </button>
            </span>
            <ModelPicker models={d.models} model={d.model} onChoose={d.chooseModel} />
            {d.model && <OptionPills schema={d.model.params} opts={d.opts} setOpt={d.setOpt} />}
            <span className="stepper" aria-label="Anzahl Bilder">
              <button type="button" aria-label="Weniger" disabled={d.count <= 1} onClick={() => d.setCount(d.count - 1)}><Minus /></button>
              <span aria-live="polite">{d.count}/4</span>
              <button type="button" aria-label="Mehr" disabled={d.count >= 4} onClick={() => d.setCount(d.count + 1)}><Plus /></button>
            </span>
          </div>
          <button type="button" className="go" onClick={generate} disabled={!canGo} aria-label={`Generieren: ${priceText(d.price, d.count, me?.credits ?? null)}`} title={priceText(d.price, d.count, me?.credits ?? null)}>
            <span className="go__label">{busy ? "Startet …" : "Generieren"}</span>
            <span className="go__price"><TokenGlyph />{d.total ?? "…"}</span>
            <ArrowUp className="go__arrow" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
