"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, AtSign, Check, Copy, Download, Film, Image as ImageIcon, ImagePlus, Maximize2, Pencil, RotateCw, SlidersHorizontal, Square, SquarePen, X } from "lucide-react";
import { JOB_ERROR } from "@/components/studio/content";
import { LoopVideo } from "@/components/studio/loop-video";
import { startErrorText } from "@/components/studio/credits";
import { usePreview } from "@/components/studio/media-preview";
import { useStudio, type Job, type StartResult } from "@/components/studio/studio-context";
import { Mark, TokenGlyph } from "@/components/studio/tachyon-token";
import { useUpload } from "@/components/studio/upload";
import { useMediaPicker } from "@/components/studio/media-picker";
import { mentionOf } from "@/components/studio/references";
import { MarkdownView } from "@/components/studio/markdown-view";
import { OptionPills } from "@/components/studio/options";
import { showValue, type JsonSchema } from "@/components/studio/schema";
import { readEvents } from "@/lib/sse";
import { priceLine, TextModelPicker, type TextModel } from "./text-model-picker";
import { restore, toHistory, type Assistant, type Msg, type Proposal } from "./thread";
import "./director.css";

/** What POST /api/director streams (src/server/director.ts). */
type DirectorEvent =
  | { type: "text"; delta: string }
  | { type: "proposals"; proposals: Proposal[] }
  | { type: "suggestions"; suggestions: string[] }
  | { type: "done"; reply: string }
  | { type: "error"; error: string; message: string }
  | { type: "budget"; allowed: boolean; turnsLeft: number; share: number }
  | { type: "charged"; credits: number };

const STORE = "tachyon:director:v1";
const MODEL_STORE = "tachyon:director:model";

/** What the Director does while it thinks, as work steps («… wird geplant»). */
const THINKING = ["Liest deinen Wunsch …", "Sucht den Hook …", "Plant Szene und Kamera …", "Wählt Modell und Format …", "Rechnet die Preise …"];
const UNREACHABLE = "Ich komme gerade nicht durch. Versuch es gleich nochmal.";
/** Example wishes the empty composer cycles through as a rotating placeholder. */
const EXAMPLES = [
  "Mein Hund als Superheld, für TikTok",
  "Werbeclip für meine Sneaker, 9:16, mit Ton",
  "Kinoszene: ein Reiter im Sandsturm bei Sonnenuntergang",
  "Produktfoto meiner Kerze auf Marmor, warmes Licht",
  "Mein Foto sagt «Willkommen bei uns»",
];

/** The Tevyon symbol, drawn in the current text colour. */
function DirectorMark() {
  return (
    <svg viewBox="0 0 1290 815" fill="currentColor" aria-hidden="true">
      <Mark />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="dr-act"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {}
      }}
      aria-label={done ? "Kopiert" : "Text kopieren"}
      title={done ? "Kopiert" : "Kopieren"}
    >
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

const ratio = (a: string) => {
  const [w = 9, h = 16] = a.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 9 / 16;
};

/** A custom idea has no picture yet: its format as a frame, never a stock image that looks like the result. */
function IdeaFrame({ kind, aspect, duration }: { kind: "image" | "video"; aspect: string; duration?: number }) {
  const r = ratio(aspect);
  const box = r >= 1 ? { width: 56, height: 56 / r } : { width: 64 * r, height: 64 };
  return (
    <span className="dr-idea" aria-hidden="true">
      <span className="dr-idea__frame" style={box}>{kind === "video" ? <Film /> : <ImageIcon />}</span>
      <span className="dr-idea__label">{aspect}{duration ? ` · ${duration} s` : ""}</span>
    </span>
  );
}

/** A started proposal in the thumbnail: running, failed or the result (click opens the large view). */
function ResultThumb({ job }: { job: Job }) {
  const preview = usePreview();
  const out = job.outputs[0];
  if (job.status === "succeeded" && out) {
    return (
      <button type="button" className="dr-result dr-result--done" onClick={() => preview.openJobs([job.id])} aria-label="Ergebnis gross ansehen">
        {out.contentType.startsWith("video/")
          ? <LoopVideo src={out.url} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={out.url} alt="Ergebnis" />}
      </button>
    );
  }
  if (job.status === "failed") return <span className="dr-result dr-result--failed" aria-hidden="true"><X /></span>;
  return <span className="dr-result" aria-hidden="true"><span className="run__orb" /></span>;
}

type Custom = Extract<Proposal, { type: "custom" }>;

/** The settings a card shows as tags (format, length, sound). */
const TAG_KEYS = ["aspect_ratio", "duration", "resolution", "generate_audio"];

function ProposalCard({
  p, price, balance, schema, startedJob, onStart, onAdjust, busy,
}: {
  p: Proposal; price: number | null; balance: number | null;
  /** The model's options, for «Anpassen» (custom proposals only). */
  schema?: JsonSchema;
  startedJob?: Job; onStart: () => void;
  /** A changed proposal; requote: its settings changed, so its price must be asked for again. */
  onAdjust?: (next: Custom, requote: boolean) => void;
  busy: boolean;
}) {
  const preview = usePreview();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const video = p.kind === "video";
  const aspect = typeof p.params.aspect_ratio === "string" ? p.params.aspect_ratio : "9:16";
  const duration = typeof p.params.duration === "number" ? p.params.duration : undefined;
  const tags = TAG_KEYS.filter((k) => p.params[k] !== undefined).map((k) => showValue(k, p.params[k]));
  const out = startedJob?.status === "succeeded" ? startedJob.outputs[0] : undefined;
  const failed = startedJob?.status === "failed";
  const running = startedJob && !out && !failed;
  // Short of credits: say so on the card before the click («Credits aufladen» in the thread).
  const short = price !== null && balance !== null && price > balance;
  const label = failed ? "Nochmal" : "Starten";
  const prompt = p.prompt;
  const adjustable = Boolean(schema && onAdjust) && !startedJob;
  return (
    <article className={`dr-card${startedJob ? " is-started" : ""}${editing && adjustable ? " is-editing" : ""}`}>
      <div className="dr-card__thumb">
        {startedJob ? <ResultThumb job={startedJob} />
          : <IdeaFrame kind={video ? "video" : "image"} aspect={aspect} duration={duration} />}
      </div>
      <div className="dr-card__body">
        <p className="dr-card__meta">
          {video ? <Film aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
          <span>{p.model}</span>
          {tags.length > 0 && <span>{tags.join(" · ")}</span>}
        </p>
        <h3 className="dr-card__title">{p.kind === "video" ? "Eigener Clip" : "Eigenes Bild"}</h3>
        <p className="dr-card__why">{p.why}</p>
        {prompt && !(editing && adjustable) && (
          <button type="button" className={`dr-card__prompt${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? "Weniger" : "Ganzen Prompt zeigen"}>
            {`«${prompt}»`}
          </button>
        )}
        {adjustable && (editing ? (
          // An approval card: change prompt and settings before the start, the price follows.
          <div className="dr-card__adjust">
            <textarea
              className="dr-card__edit"
              value={p.prompt}
              rows={3}
              maxLength={2000}
              aria-label="Prompt anpassen"
              onChange={(e) => onAdjust!({ ...p, prompt: e.target.value, params: { ...p.params, prompt: e.target.value } }, false)}
            />
            <div className="dr-card__opts">
              <OptionPills schema={schema!} opts={p.params} setOpt={(k, v) => onAdjust!({ ...p, params: { ...p.params, [k]: v } }, true)} side="top" />
              <button type="button" className="dr-act dr-act--text" onClick={() => setEditing(false)}><Check aria-hidden="true" /> Fertig</button>
            </div>
          </div>
        ) : (
          <button type="button" className="dr-act dr-act--text dr-card__adjust-open" onClick={() => setEditing(true)}><SlidersHorizontal aria-hidden="true" /> Anpassen</button>
        ))}
      </div>
      <div className="dr-card__side">
        {out ? (
          <>
            <button type="button" className="dr-card__btn" onClick={() => preview.openJobs([startedJob!.id])}><Maximize2 aria-hidden="true" /> Ansehen</button>
            <a className="dr-card__btn" href={out.url} download={`tevyon-${startedJob!.id.slice(0, 8)}.${out.contentType.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") ?? "bin"}`}><Download aria-hidden="true" /> Herunterladen</a>
          </>
        ) : running ? (
          <span className="dr-card__state" role="status">{startedJob!.status === "queued" ? "In der Warteschlange …" : video ? "Wird gedreht …" : "Entsteht …"}</span>
        ) : short ? (
          <>
            <span className="dr-card__state">Dafür fehlen {price! - balance!} Credits.</span>
            <a className="go dr-card__go go--quiet" href="/credits">
              <span className="go__label">Credits kaufen</span>
              <span className="go__price"><TokenGlyph />{price}</span>
            </a>
          </>
        ) : (
          <>
            {failed && <span className="dr-card__state dr-card__state--err">{JOB_ERROR[startedJob!.error ?? ""] ?? "Fehlgeschlagen. Credits zurück."}</span>}
            <button
              type="button"
              className="go dr-card__go"
              disabled={busy || price === null}
              onClick={onStart}
              aria-label={price !== null ? `${label}: ${price} Credits` : `${label}: Preis nicht verfügbar`}
            >
              <span className="go__label">{label}</span>
              <span className="go__price"><TokenGlyph />{price ?? "…"}</span>
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function Director() {
  const { jobs, refresh, start: startJob, catalog, quote, me } = useStudio();
  const preview = usePreview();
  /** Image models that take reference images get the attached photo as «image 1». */
  const takesRefs = (jobType: string) => Boolean((catalog.find((c) => c.jobType === jobType)?.params.properties?.references as { maxItems?: number } | undefined)?.maxItems);
  const usesPhoto = (p: Proposal) => Boolean(up.url) && (p.kind === "video" || (p.kind === "image" && takesRefs(p.jobType)));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "waiting" | "streaming">("idle");
  const [tick, setTick] = useState(0);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyStart, setBusyStart] = useState(false);
  /** Prices the server named when it refused an older one (price_changed), per proposal "message:card". */
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [models, setModels] = useState<TextModel[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [share, setShare] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [owed, setOwed] = useState(0);
  const up = useUpload();
  // The clip button opens earlier uploads and results beside it; a new photo is uploaded (and scanned) as before.
  const picker = useMediaPicker({ kind: "image", onPick: ([url]) => url && up.setUrl(url), onFiles: ([f]) => f && !up.busy && void up.upload(f) });
  const area = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const stream = useRef<AbortController | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
      if (Array.isArray(saved?.msgs)) setMsgs(restore(saved.msgs));
      if (saved?.photo) up.setUrl(saved.photo);
      const m = localStorage.getItem(MODEL_STORE);
      if (m) setModelId(m);
    } catch {}
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Save only after the stored chat was read, otherwise the first render would overwrite it with an empty one.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ msgs, photo: up.url }));
      if (modelId) localStorage.setItem(MODEL_STORE, modelId);
      else localStorage.removeItem(MODEL_STORE);
    } catch {}
  }, [restored, msgs, up.url, modelId]);

  const loadModels = useCallback(async () => {
    const r = await fetch("/api/director/models", { cache: "no-store" }).catch(() => null);
    const res = (await r?.json().catch(() => null)) as { ok?: boolean; models?: TextModel[]; share?: number; paying?: boolean; owed?: number } | null;
    if (!res?.ok || !res.models) return;
    setModels(res.models);
    setShare(typeof res.share === "number" ? res.share : null);
    setPaying(res.paying === true);
    setOwed(typeof res.owed === "number" ? res.owed : 0);
  }, []);
  useEffect(() => {
    void loadModels();
  }, [loadModels]);
  const model = models.find((m) => m.id === modelId) ?? models.find((m) => m.default) ?? models[0];

  // Grow the message field with its content (up to a limit set in CSS), like the image composer.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const last = msgs.at(-1);
  const lastLength = last?.content.length ?? 0;
  useEffect(() => {
    // Follow the answer while it is written, unless the user scrolled up to read.
    const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 280;
    if (phase === "waiting" || nearBottom) end.current?.scrollIntoView({ behavior: phase === "streaming" ? "auto" : "smooth", block: "end" });
  }, [msgs.length, lastLength, phase]);
  // Scrolled up: a button above the composer leads back to the end of the chat.
  const [away, setAway] = useState(false);
  useEffect(() => {
    const check = () => setAway(window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 320);
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [msgs.length, lastLength]);
  useEffect(() => {
    if (phase !== "waiting") return;
    const t = setInterval(() => setTick((x) => x + 1), 2400);
    return () => clearInterval(t);
  }, [phase]);
  // The empty composer shows one example wish after the other (not with reduced motion, not once the user types).
  const [example, setExample] = useState(0);
  const empty = msgs.length === 0;
  useEffect(() => {
    if (!empty || text || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setExample((x) => (x + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, [empty, text]);
  // With a mouse, the message field is ready to type into; on phones the keyboard waits for a tap.
  useEffect(() => {
    if (restored && window.matchMedia("(pointer: fine)").matches) area.current?.focus();
  }, [restored]);

  /** Changes the answer at the end of the chat (the one being written). */
  function patchAnswer(patch: Partial<Assistant> | ((m: Assistant) => Partial<Assistant>)) {
    setMsgs((ms) => {
      const a = ms.at(-1);
      if (!a || a.role !== "assistant") return ms;
      return [...ms.slice(0, -1), { ...a, ...(typeof patch === "function" ? patch(a) : patch) }];
    });
  }

  /** Replaces one proposal of an answer (the user adjusted it before the start). */
  function setProposal(i: number, j: number, next: Proposal) {
    setMsgs((ms) => ms.map((m, k) => (k === i && m.role === "assistant" ? { ...m, proposals: m.proposals.map((x, l) => (l === j ? next : x)) } : m)));
  }
  /** The newest price request per card wins; an older answer that arrives late is ignored. */
  const quoting = useRef<Record<string, number>>({});
  async function adjust(i: number, j: number, next: Extract<Proposal, { type: "custom" }>, requote: boolean) {
    const key = `${i}:${j}`;
    setPrices(({ [key]: _old, ...rest }) => rest);
    if (!requote) return setProposal(i, j, next);
    setProposal(i, j, { ...next, credits: null });
    const seq = (quoting.current[key] ?? 0) + 1;
    quoting.current[key] = seq;
    const credits = await quote(next.jobType, next.params).catch(() => null);
    if (quoting.current[key] === seq) setProposal(i, j, { ...next, credits });
  }

  async function send(content: string) {
    const q = content.trim();
    if (!q || phase !== "idle") return;
    setText("");
    await ask([...msgs, { role: "user", content: q, ...(up.url ? { image: up.url } : {}) }]);
  }

  /** Answers the last answer again (after a failure, a stop, or because the user wants another plan). */
  function regenerate() {
    if (phase !== "idle" || last?.role !== "assistant") return;
    const next = msgs.slice(0, -1);
    if (next.at(-1)?.role === "user") void ask(next);
  }

  /** Sends the chat that ends with the user's message and streams the answer in below it. */
  async function ask(next: Msg[]) {
    setError(null);
    setMsgs([...next, { role: "assistant", content: "", proposals: [], started: {}, state: "waiting", ...(model ? { model: model.name } : {}) }]);
    setPhase("waiting");
    const ac = new AbortController();
    const began = Date.now();
    stream.current = ac;
    try {
      const r = await fetch("/api/director", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          history: toHistory(next, (id) => jobs.find((j) => j.id === id)?.status),
          ...(model ? { model: model.id } : {}),
          ...(up.url ? { photo: up.url } : {}),
        }),
        signal: ac.signal,
      });
      if (!r.body || !(r.headers.get("content-type") ?? "").includes("text/event-stream")) {
        // Refusals come as JSON with a reply to show: budget, demo, provider down, a model the server no longer knows.
        const res = (await r.json().catch(() => ({}))) as { error?: string; reply?: string };
        if (res.error === "unknown_model") setModelId(null);
        patchAnswer({ content: res.reply ?? UNREACHABLE, state: "failed" });
        return;
      }
      for await (const e of readEvents<DirectorEvent>(r.body)) {
        if (e.type === "text") {
          setPhase("streaming");
          patchAnswer((a) => ({ content: a.content + e.delta, state: "streaming" }));
        } else if (e.type === "proposals") patchAnswer({ proposals: e.proposals });
        else if (e.type === "suggestions") patchAnswer({ suggestions: e.suggestions });
        else if (e.type === "done") patchAnswer({ content: e.reply, state: undefined, took: Math.max(1, Math.round((Date.now() - began) / 1000)) });
        else if (e.type === "error") patchAnswer((a) => ({ content: a.content ? `${a.content}\n\n${e.message}` : e.message, state: "failed" }));
        else if (e.type === "budget") setShare(e.share);
        else if (e.type === "charged") {
          patchAnswer({ charged: e.credits });
          void refresh();
        }
      }
      patchAnswer((a) => (a.state === "waiting" || a.state === "streaming" ? { state: a.content.trim() ? undefined : "failed", content: a.content || UNREACHABLE } : {}));
    } catch {
      patchAnswer((a) => ac.signal.aborted
        ? { state: "stopped", content: a.content.trim() ? a.content : "Gestoppt." }
        : { state: "failed", content: a.content ? `${a.content}\n\n${UNREACHABLE}` : UNREACHABLE });
    } finally {
      stream.current = null;
      setPhase("idle");
      void loadModels();
    }
  }

  function stop() {
    stream.current?.abort();
  }

  async function start(i: number, j: number, p: Proposal, price: number | null) {
    if (busyStart || price === null) return;
    if (usesPhoto(p) && up.url && !consent) {
      setError("Bitte bestätige unten die Einwilligung für das Foto.");
      return;
    }
    setBusyStart(true);
    setError(null);
    // The price on the card is the one the user agreed to; a higher server price starts nothing (price_changed).
    const params = !usesPhoto(p) || !up.url ? p.params : p.kind === "video" ? { ...p.params, image: up.url } : { ...p.params, references: [up.url] };
    const res: StartResult = await startJob(p.jobType, params, 1, { maxCredits: price });
    setBusyStart(false);
    if (!res.ok) {
      const now = res.credits;
      if (res.error === "price_changed" && now !== undefined) setPrices((x) => ({ ...x, [`${i}:${j}`]: now }));
      setError(startErrorText(res));
      return;
    }
    const id = res.ids[0]!;
    setMsgs((m) => m.map((x, k) => (k === i && x.role === "assistant" ? { ...x, started: { ...x.started, [j]: id } } : x)));
  }

  function reset() {
    stop();
    setMsgs([]);
    setPrices({});
    up.setUrl(null);
    setConsent(false);
    setError(null);
    requestAnimationFrame(() => area.current?.focus());
  }

  /** A photo dropped on or pasted into the composer is attached like one picked from disk. */
  const [drag, setDrag] = useState(false);
  const takeImage = (files: FileList | File[] | undefined | null) => {
    const f = [...(files ?? [])].find((x) => /^image\/(png|jpeg|webp)$/.test(x.type));
    if (f && !up.busy) void up.upload(f);
    return Boolean(f);
  };

  const busy = phase !== "idle";
  const lastIndex = msgs.length - 1;
  /**
   * The user's newest message goes back into the composer, its answer goes away (a sent
   * message is edited, not copied). Not once something was started from that answer: its cards hold the running jobs.
   */
  const lastUser = msgs.findLastIndex((m) => m.role === "user");
  const editable = !busy && lastUser >= 0 && msgs.slice(lastUser + 1).every((m) => m.role !== "assistant" || !Object.keys(m.started).length);
  function editLast() {
    if (!editable) return;
    setText(msgs[lastUser]!.content);
    setMsgs(msgs.slice(0, lastUser));
    requestAnimationFrame(() => area.current?.focus());
  }
  /**
   * Puts a text into the composer (after what the user already wrote, with append), cursor at its end, and lets the
   * composer light up once (CSS `.is-primed`).
   */
  const box = useRef<HTMLDivElement>(null);
  function prime(t: string, append = false) {
    const next = append && text.trim() ? `${text.trimEnd()} ${t}` : t;
    setText(next);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(next.length, next.length);
      const el = box.current;
      if (!el) return;
      el.classList.remove("is-primed");
      void el.offsetWidth; // restarts the animation when the same reply is chosen twice
      el.classList.add("is-primed");
    });
  }

  const composer = (
    <div className="composer composer--director" role="region" aria-label="Nachricht an den Director">
      {away && !empty && (
        <button type="button" className="dr-jump" onClick={() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" })} aria-label="Zum Ende der Unterhaltung">
          <ArrowDown aria-hidden="true" />
        </button>
      )}
      {error && <p className="composer__alert" role="alert">{error}</p>}
      <div
        ref={box}
        className={`composer__box${drag ? " is-drag" : ""}`}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
        }}
        onDrop={(e) => {
          setDrag(false);
          if (takeImage(e.dataTransfer.files)) e.preventDefault();
        }}
      >
        {up.url && (
          <div className="dr-attach">
            <span className="dr-attach__thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={up.url} alt="Angehängtes Foto" />
              <button type="button" className="dr-attach__remove" aria-label="Foto entfernen" onClick={() => up.setUrl(null)}><X /></button>
            </span>
            <label className="consent dr-attach__consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>Ich habe die Einwilligung aller abgebildeten Personen bzw. die Rechte am Bild.</span>
            </label>
          </div>
        )}
        <textarea
          ref={area}
          className="composer__prompt"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={empty ? `Beschreib deine Idee, z. B. «${EXAMPLES[example]}»` : "Antworte dem Director …"}
          aria-label="Nachricht an den Director"
          onPaste={(e) => {
            if (takeImage(e.clipboardData.files)) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && busy) stop();
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <div className="composer__bar">
          <div className="composer__tools">
            <span className="pill-group" aria-label="Foto">
              <button
                type="button"
                className="pill-btn pill-btn--icon"
                onClick={(e) => picker.open(e.currentTarget)}
                aria-haspopup="dialog"
                disabled={up.busy}
                title={up.url ? "Foto ersetzen" : "Foto anhängen"}
                aria-label={up.url ? "Foto ersetzen" : "Foto anhängen"}
              >
                {up.busy ? <span className="ring" aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--icon"
                disabled={!up.url}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const el = area.current;
                  const caret = el?.selectionStart ?? text.length;
                  const before = text.slice(0, caret);
                  const token = `${before && !/\s$/.test(before) ? " " : ""}${mentionOf(1)} `;
                  setText(before + token + text.slice(caret));
                  requestAnimationFrame(() => {
                    el?.focus();
                    el?.setSelectionRange((before + token).length, (before + token).length);
                  });
                }}
                title={up.url ? "Foto im Text erwähnen (@Bild1)" : "Erst ein Foto anhängen"}
                aria-label="Foto erwähnen"
              >
                <AtSign aria-hidden="true" />
              </button>
            </span>
            {model && <TextModelPicker models={models} model={model} share={share} paying={paying} owed={owed} onChoose={setModelId} />}
            {up.error && <span className="note note--error">{up.error}</span>}
          </div>
          {busy ? (
            <button type="button" className="go go--stop" onClick={stop} aria-label="Antwort stoppen" title="Stoppen (Esc)">
              <span className="go__label">Stopp</span>
              <Square className="go__arrow" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="go"
              onClick={() => void send(text)}
              disabled={!text.trim() || model?.allowed === false}
              aria-label={model?.paid ? `Senden: ${priceLine(model)}` : "Senden"}
              title={model?.paid ? priceLine(model) : undefined}
            >
              <span className="go__label">Senden</span>
              {model?.paid && model.credits && <span className="go__price"><TokenGlyph />≈ {model.credits.typical}</span>}
              <ArrowUp className="go__arrow" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {picker.el}
    </div>
  );

  if (empty) {
    return (
      <div className="studio studio--director is-empty">
        <section className="dr-hello">
          <span className="dr-hello__mark" aria-hidden="true"><DirectorMark /></span>
          <h1 className="display dr-hello__title">Was drehen wir heute?</h1>
          <p className="page-sub">Sag mir, was du willst. Ich plane den viralen Clip, wähle Effekt und Modell und zeige dir vorher den Preis. Gestartet wird erst, wenn du klickst.</p>
        </section>
        {composer}
      </div>
    );
  }

  return (
    <div className="studio studio--director">
      <div className="dr-thread" role="log" aria-label="Unterhaltung mit dem Director">
        <header className="dr-bar">
          <span className="dr-bar__title"><span className="dr-avatar" aria-hidden="true"><DirectorMark /></span>Director</span>
          <button type="button" className="dr-bar__new" onClick={reset}><SquarePen aria-hidden="true" /> Neuer Chat</button>
        </header>
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="dr-msg dr-msg--user">
              {m.image && (
                <button type="button" className="dr-msg__zoom" aria-label="Angehängtes Foto ansehen" onClick={() => preview.openEntries([{ url: m.image!, kind: "image", chip: "Dein Foto", title: "Angehängtes Foto" }])}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="dr-msg__img" src={m.image} alt="Angehängtes Foto" />
                </button>
              )}
              <div className="dr-msg__line">
                <span className="dr-actions">
                  {i === lastUser && editable && (
                    <button type="button" className="dr-act" onClick={editLast} aria-label="Nachricht bearbeiten" title="Bearbeiten"><Pencil aria-hidden="true" /></button>
                  )}
                  <CopyButton text={m.content} />
                </span>
                <p className="dr-bubble">{m.content}</p>
              </div>
            </div>
          ) : (
            <div key={i} className={`dr-msg dr-msg--bot${m.state === "failed" ? " dr-msg--failed" : ""}`} aria-busy={m.state === "waiting" || m.state === "streaming"}>
              <div className="dr-who">
                <span className={`dr-avatar${m.state === "waiting" || m.state === "streaming" ? " is-live" : ""}`} aria-hidden="true"><DirectorMark /></span>
                <span className="dr-who__name">Director</span>
                {m.model && <span className="dr-who__model">{m.model}</span>}
                {m.took ? <span className="dr-who__model" title="So lange hat der Director an dieser Antwort gearbeitet">{m.took} s</span> : null}
              </div>
              <div className="dr-msg__body">
                {m.state === "waiting" ? (
                  <div className="dr-thinking" role="status"><span className="dr-thinking__text">{THINKING[tick % THINKING.length]}</span></div>
                ) : (
                  <MarkdownView className="dr-md" text={m.content} tail={m.state === "streaming" ? <span className="dr-caret" aria-hidden="true" /> : null} />
                )}
                {m.proposals.length > 0 && (
                  <div className="dr-cards" aria-label="Vorschläge">
                    {m.proposals.map((p, j) => {
                      const price = prices[`${i}:${j}`] ?? p.credits;
                      return (
                        <ProposalCard
                          key={j}
                          p={p}
                          price={price}
                          balance={me && !me.demo ? me.credits : null}
                          schema={catalog.find((c) => c.jobType === p.jobType)?.params}
                          busy={busyStart}
                          startedJob={m.started[j] ? jobs.find((x) => x.id === m.started[j]) : undefined}
                          onStart={() => void start(i, j, p, price)}
                          onAdjust={(next, requote) => void adjust(i, j, next, requote)}
                        />
                      );
                    })}
                  </div>
                )}
                {m.state !== "waiting" && m.state !== "streaming" && (
                  <div className="dr-actions">
                    {m.state === "failed" || m.state === "stopped" ? (
                      i === lastIndex && !busy && (
                        <button type="button" className="dr-act dr-act--text" onClick={regenerate}><RotateCw aria-hidden="true" /> Erneut versuchen</button>
                      )
                    ) : (
                      <>
                        <CopyButton text={m.content} />
                        {i === lastIndex && !busy && !Object.keys(m.started).length && (
                          <button type="button" className="dr-act" onClick={regenerate} aria-label="Neu antworten" title="Neu antworten"><RotateCw aria-hidden="true" /></button>
                        )}
                      </>
                    )}
                    {m.state === "stopped" && <span className="dr-msg__note">Gestoppt</span>}
                    {m.charged ? <span className="dr-msg__charged"><TokenGlyph />{m.charged} Credits</span> : null}
                  </div>
                )}
                {/*
                  Replies to tap: only under the newest answer. A tap fills the composer
                  and sends nothing (a message with the strongest models costs credits), Enter sends it.
                */}
                {i === lastIndex && !busy && !m.state && m.suggestions?.length ? (
                  <div className="dr-replies" role="group" aria-label="Antworten zum Übernehmen">
                    {m.suggestions.map((s) => (
                      <button key={s} type="button" className="pill-btn dr-reply" onClick={() => prime(s, true)}>{s}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ),
        )}
        <div ref={end} className="dr-end" />
      </div>
      {composer}
    </div>
  );
}
