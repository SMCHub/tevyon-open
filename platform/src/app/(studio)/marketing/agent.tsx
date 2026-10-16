"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Check, Copy, Download, Play, SlidersHorizontal, Sparkles, Square, Trash2 } from "lucide-react";
import { JOB_ERROR } from "@/components/studio/content";
import { LoopVideo } from "@/components/studio/loop-video";
import { PreviewButton, usePreview } from "@/components/studio/media-preview";
import { useStudio, type Job } from "@/components/studio/studio-context";
import { TokenGlyph } from "@/components/studio/tachyon-token";
import { readEvents } from "@/lib/sse";
import { TextModelPicker, type TextModel } from "../director/text-model-picker";
import { AvatarSlot, ProductSlot, type ResultPick } from "./slots";
import { briefText, startBody, type Creative, type Product, type Run, type Style } from "./data";
import type { StartResponse } from "./results";
import { CATEGORY_ICON } from "./sidebar";
import { AspectBox, Cover } from "./templates";

type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; creatives: Creative[]; started: Record<number, string[]>; state?: "waiting" | "streaming" | "failed" | "stopped"; charged?: number };
type Assistant = Extract<Msg, { role: "assistant" }>;
type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "proposals"; proposals: Creative[] }
  | { type: "done"; reply: string }
  | { type: "error"; error: string; message: string }
  | { type: "budget"; allowed: boolean; turnsLeft: number; share: number }
  | { type: "charged"; credits: number };

export type Brief = { goal: string | null; channels: string[]; audience: string; offer: string; tone: string | null; language: string };

const STORE = "tachyon:ma:agent:v1";
const MODEL_STORE = "tachyon:ma:model";
const GOALS = ["Increase sales", "Product launch", "Awareness", "Win leads", "Engagement", "Promotion / sale"];
const CHANNELS = ["Instagram Feed", "Instagram Stories / Reels", "TikTok", "Facebook", "YouTube", "Shop / Marketplace", "Poster / Print"];
const TONES = ["Premium", "Playful", "Relatable", "Factual", "Bold"];
const LANGUAGES = ["English", "German", "French", "Italian", "Spanish", "Portuguese", "Dutch"];
const THINKING = ["Reading your brief …", "Finding fitting styles …", "Writing claims and captions …", "Planning the formats …"];

/** Own texts for the refusals; the agent shares the Director's budget, so its codes are the Director's. */
const REFUSAL: Record<string, string> = {
  director_demo: "The Marketing Agent needs the server's language model access and is off in demo mode. Templates and styles still work.",
  director_budget: "Your free allowance for today is used up. Pick a faster model or come back tomorrow.",
  director_busy: "The agent is still working on your last message. One moment.",
  director_unavailable: "The agent can't get through right now. Please try again in a moment.",
  foreign_input: "This product photo does not belong to your account. Upload it again.",
  invalid_params: "Say briefly what it is about: product, goal and channel.",
  credits_owed: "Your account owes Credits (a refund or a payment dispute). The agent is paused until they are settled.",
};

function restore(msgs: Msg[]): Msg[] {
  return msgs.flatMap((m): Msg[] => {
    if (m.role !== "assistant" || (m.state !== "waiting" && m.state !== "streaming")) return [m];
    return m.content.trim() ? [{ ...m, state: "stopped" }] : [];
  });
}

/** What the model reads back: its earlier creatives in short, failed and stopped answers left out. */
function toHistory(msgs: Msg[]) {
  return msgs
    .filter((m) => m.role === "user" || (m.state !== "failed" && m.state !== "stopped" && m.content.trim()))
    .map((m) => ({
      role: m.role,
      content: m.role === "assistant" && m.creatives.length
        ? `${m.content}\n[Creatives: ${m.creatives.map((c) => `${c.styleId} ${c.aspect}${c.wish ? ` “${c.wish}”` : ""}`).join(" | ")}]`
        : m.content,
    }));
}

type Props = {
  find: (styleId: string) => Style | undefined;
  products: Product[];
  product: Product | null;
  productImage: string | null;
  onProduct: (id: string | null) => void;
  onUpload: (f: File | string) => Promise<void>;
  onImport: (p: Omit<Product, "id" | "pick">) => Product;
  results: ResultPick[];
  onResult: (jobId: string) => Promise<string | null>;
  onManageProducts: () => void;
  avatar: string | null;
  onAvatar: (u: string | null) => void;
  consent: boolean;
  onConsent: (c: boolean) => void;
  onAdjust: (run: Run) => void;
  onStarted: (res: StartResponse) => Promise<void>;
  errorText: (code: string | undefined) => string;
};

/**
 * “Plan campaign”: the brief (product, goal, channels, audience, offer, tone, language) goes to the Marketing Agent,
 * which answers with a short idea and up to four priced creatives with lettering and caption. Each starts with a click
 * at the shown price, or opens in the editor to adjust. The chat stays in this browser.
 */
export function CampaignAgent(p: Props) {
  const { jobs, me, refresh } = useStudio();
  const [brief, setBrief] = useState<Brief>({ goal: null, channels: [], audience: "", offer: "", tone: null, language: "English" });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [models, setModels] = useState<TextModel[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [share, setShare] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [owed, setOwed] = useState(0);
  const [live, setLive] = useState(true);
  const [thinking, setThinking] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // Chat, brief and model live in this browser (no chat is stored on the server).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { msgs?: Msg[]; brief?: Brief } | null;
      if (saved?.msgs) setMsgs(restore(saved.msgs));
      if (saved?.brief) setBrief(saved.brief);
      setModelId(localStorage.getItem(MODEL_STORE));
    } catch {}
    setRestored(true);
  }, []);
  // Save only once the stored plan was read: the first render's empty chat would otherwise overwrite it.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ msgs: msgs.slice(-30), brief }));
    } catch {}
  }, [restored, msgs, brief]);

  const loadModels = useCallback(async () => {
    const r = await fetch("/api/director/models", { cache: "no-store" }).catch(() => null);
    const res = (await r?.json().catch(() => null)) as { ok?: boolean; live?: boolean; models?: TextModel[]; share?: number; paying?: boolean; owed?: number } | null;
    if (!res?.ok || !res.models) return;
    setModels(res.models);
    setShare(res.share ?? null);
    setPaying(Boolean(res.paying));
    setOwed(res.owed ?? 0);
    setLive(res.live !== false);
  }, []);
  useEffect(() => void loadModels(), [loadModels]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setThinking((n) => (n + 1) % THINKING.length), 1800);
    return () => clearInterval(t);
  }, [busy]);
  // A block, not an arrow's value: current Chrome returns a promise from scrollIntoView, and React would take it for a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs.length]);

  const model = models.find((m) => m.id === modelId) ?? models.find((m) => m.default) ?? models[0];
  const set = (patch: Partial<Brief>) => setBrief((b) => ({ ...b, ...patch }));
  const toggleChannel = (c: string) => set({ channels: brief.channels.includes(c) ? brief.channels.filter((x) => x !== c) : [...brief.channels, c] });

  const patchLast = (fn: (a: Assistant) => Assistant) =>
    setMsgs((list) => {
      const last = list.at(-1);
      return last?.role === "assistant" ? [...list.slice(0, -1), fn(last)] : list;
    });

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setNote(null);
    const history = toHistory([...msgs, { role: "user", content }]);
    setMsgs((list) => [...list, { role: "user", content }, { role: "assistant", content: "", creatives: [], started: {}, state: "waiting" }]);
    setInput("");
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const r = await fetch("/api/marketing/agent", {
        method: "POST",
        signal: ac.signal,
        body: JSON.stringify({
          history, ...(model ? { model: model.id } : {}),
          ...(p.productImage ? { photo: p.productImage, hasPhoto: true } : {}),
          hasAvatar: Boolean(p.avatar),
          ...(p.product ? { product: { name: p.product.name, description: p.product.description } } : {}),
        }),
      });
      if (!r.ok || !r.body || !r.headers.get("content-type")?.includes("text/event-stream")) {
        const res = (await r.json().catch(() => null)) as { error?: string; reply?: string } | null;
        const reply = REFUSAL[res?.error ?? ""] ?? res?.reply ?? REFUSAL.director_unavailable!;
        patchLast((a) => ({ ...a, content: reply, state: "failed" }));
        if (res?.error === "director_demo") setLive(false);
        return;
      }
      for await (const e of readEvents<AgentEvent>(r.body)) {
        if (e.type === "text") patchLast((a) => ({ ...a, content: a.content + e.delta, state: "streaming" }));
        else if (e.type === "proposals") patchLast((a) => ({ ...a, creatives: e.proposals.filter((c) => c.type === "marketing") }));
        else if (e.type === "done") patchLast((a) => ({ ...a, content: e.reply, state: undefined }));
        else if (e.type === "error") patchLast((a) => ({ ...a, content: a.content || REFUSAL.director_unavailable!, state: "failed" }));
        else if (e.type === "charged") patchLast((a) => ({ ...a, charged: e.credits }));
        else if (e.type === "budget") setShare(e.share);
      }
      if (model?.paid) void refresh();
    } catch {
      patchLast((a) => (ac.signal.aborted ? { ...a, state: a.content ? "stopped" : "failed", content: a.content || "Stopped." } : { ...a, content: a.content || REFUSAL.director_unavailable!, state: "failed" }));
    } finally {
      setBusy(false);
      abort.current = null;
      void loadModels();
    }
  }

  function plan() {
    const what = p.product ? `Product: ${p.product.name}${p.product.description ? ` – ${p.product.description}` : ""}` : "No product photo yet.";
    void send(`Plan a campaign.\n${what}\n${briefText(brief)}`);
  }

  // Start one creative at its shown price, with the product and avatar of the brief.
  const [starting, setStarting] = useState<string | null>(null);
  async function start(msgIndex: number, i: number, c: Creative): Promise<boolean> {
    const style = p.find(c.styleId);
    if (!style) return false;
    const key = `${msgIndex}:${i}`;
    setStarting(key);
    setNote(null);
    const run: Run = {
      styleId: c.styleId, ...(c.wish ? { wish: c.wish } : {}), aspect: c.aspect, ...(c.duration !== undefined ? { duration: c.duration } : {}),
      ...(p.productImage ? { product: p.productImage } : {}), ...(p.avatar && style.avatar !== "none" ? { avatar: p.avatar } : {}),
    };
    const r = await fetch("/api/marketing", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(startBody(run, style, { count: 1, consent: p.consent, maxCredits: c.credits })),
    }).catch(() => undefined);
    const res = (await r?.json().catch(() => undefined)) as StartResponse | undefined;
    setStarting(null);
    if (!res?.ok) {
      setNote(res?.error === "price_changed" && res.credits !== undefined
        ? `“${c.title}” now costs ${res.credits} Credits. Plan again or open it in the editor.`
        : `“${c.title}”: ${p.errorText(res?.error)}`);
      return false;
    }
    setMsgs((list) => list.map((m, k) => (k === msgIndex && m.role === "assistant" ? { ...m, started: { ...m.started, [i]: (res.jobs ?? []).map((j) => j.id) } } : m)));
    await p.onStarted(res);
    return true;
  }

  const blocker = (c: Creative): string | null => {
    const style = p.find(c.styleId);
    if (!style?.available) return "Not available right now";
    if (c.credits === null) return "No price";
    if (style.product === "required" && !p.productImage) return "Product photo missing";
    if (style.avatar === "required" && !p.avatar) return "Avatar missing";
    if (p.avatar && style.avatar !== "none" && !p.consent) return "Consent missing";
    return null;
  };

  async function startAll(msgIndex: number, list: Creative[], started: Record<number, string[]>) {
    for (const [i, c] of list.entries()) {
      if (started[i] || blocker(c)) continue;
      if (!(await start(msgIndex, i, c))) break;
    }
  }

  const empty = msgs.length === 0;
  return (
    <section className="ma-agent" aria-label="Plan campaign">
      <div className="ma-agent__brief">
        <header className="ma-agent__head">
          <span className="ma-kicker"><Bot aria-hidden="true" /> Marketing Agent</span>
          <h1 className="ma-agent__title">Plan campaign</h1>
          <p className="ms-fine">Give product, goal and channels. The agent plans up to four finished creatives with claim, caption and price. It starts nothing itself: you decide with one click.</p>
        </header>

        <div className="ma-brief__slots">
          <ProductSlot products={p.products} product={p.product} image={p.productImage} onChoose={p.onProduct} onUpload={p.onUpload} onImport={p.onImport} onClear={() => p.onProduct(null)} onManage={p.onManageProducts} results={p.results} onResult={p.onResult} />
          <AvatarSlot url={p.avatar} onUrl={(u) => { p.onAvatar(u); p.onConsent(false); }} onError={setNote} required={false} />
          <p className="ma-brief__hint">{p.product ? <><strong>{p.product.name}</strong>{p.product.description ? ` · ${p.product.description.slice(0, 90)}` : ""}</> : "Upload a product photo or fetch it from a shop link. An avatar is only needed for UGC and model photos."}</p>
        </div>
        {p.avatar && (
          <label className="consent ms-consent">
            <input type="checkbox" checked={p.consent} onChange={(e) => p.onConsent(e.target.checked)} />
            <span>I am the person in the avatar photo or have their consent.</span>
          </label>
        )}

        <fieldset className="ma-field">
          <legend>Goal</legend>
          <div className="ms-chips">
            {GOALS.map((g) => <button key={g} type="button" className={`ms-chip${brief.goal === g ? " is-on" : ""}`} aria-pressed={brief.goal === g} onClick={() => set({ goal: brief.goal === g ? null : g })}>{g}</button>)}
          </div>
        </fieldset>
        <fieldset className="ma-field">
          <legend>Channels</legend>
          <div className="ms-chips">
            {CHANNELS.map((c) => <button key={c} type="button" className={`ms-chip${brief.channels.includes(c) ? " is-on" : ""}`} aria-pressed={brief.channels.includes(c)} onClick={() => toggleChannel(c)}>{brief.channels.includes(c) && <Check />}{c}</button>)}
          </div>
        </fieldset>
        <div className="ma-field ma-field--grid">
          <label>
            <span>Audience</span>
            <input className="wish" value={brief.audience} onChange={(e) => set({ audience: e.target.value.slice(0, 200) })} placeholder="e.g. young city dwellers, 20–35, health-conscious" />
          </label>
          <label>
            <span>Offer and message</span>
            <input className="wish" value={brief.offer} onChange={(e) => set({ offer: e.target.value.slice(0, 200) })} placeholder="e.g. −20% at launch, sugar-free" />
          </label>
        </div>
        <fieldset className="ma-field">
          <legend>Tone and language</legend>
          <div className="ms-chips">
            {TONES.map((t) => <button key={t} type="button" className={`ms-chip${brief.tone === t ? " is-on" : ""}`} aria-pressed={brief.tone === t} onClick={() => set({ tone: brief.tone === t ? null : t })}>{t}</button>)}
            <select className="ma-select" value={brief.language} onChange={(e) => set({ language: e.target.value })} aria-label="Language of the texts">
              {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
        </fieldset>

        <div className="ma-brief__go">
          {model && <TextModelPicker models={models} model={model} share={share} paying={paying} owed={owed} onChoose={(id) => { setModelId(id); try { localStorage.setItem(MODEL_STORE, id); } catch {} }} />}
          <button type="button" className="go" onClick={plan} disabled={busy || !live} aria-label="Plan campaign">
            <span className="go__label">{busy ? THINKING[thinking] : "Plan campaign"}</span>
            <Sparkles className="go__arrow" aria-hidden="true" />
          </button>
        </div>
        {!live && <p className="note" role="status">{REFUSAL.director_demo}</p>}
        <p className="ms-fine">Planning is free within the daily allowance (the same as the Director's); the strongest models cost Credits per message. Every creative shows its price before the start.</p>
      </div>

      <div className="ma-agent__chat" aria-live="polite">
        {empty ? (
          <div className="empty ma-agent__empty">
            <Bot aria-hidden="true" />
            <p>No plan yet. Fill in the brief and click “Plan campaign”.<br />Or write freely, e.g. “Black Friday sale for my headphones, TikTok and Stories”.</p>
          </div>
        ) : (
          <>
            <div className="ma-chat__bar">
              <span className="ms-fine">{msgs.filter((m) => m.role === "user").length} messages</span>
              <button type="button" className="ms-mini" onClick={() => { abort.current?.abort(); setMsgs([]); setNote(null); }} disabled={busy}><Trash2 /> New plan</button>
            </div>
            {msgs.map((m, k) => m.role === "user" ? (
              <p key={k} className="ma-msg ma-msg--user">{m.content}</p>
            ) : (
              <div key={k} className={`ma-msg ma-msg--agent${m.state === "failed" ? " is-failed" : ""}`}>
                {m.state === "waiting" ? <p className="ma-msg__wait"><span className="ring" aria-hidden="true" /> {THINKING[thinking]}</p> : <p className="ma-msg__text">{m.content}{m.state === "streaming" && <span className="ma-caret" aria-hidden="true" />}</p>}
                {m.state === "stopped" && <p className="ms-fine">Stopped.</p>}
                {m.charged !== undefined && <p className="ms-fine"><TokenGlyph /> This message cost {m.charged} Credits.</p>}
                {m.creatives.length > 0 && (
                  <>
                    <div className="ma-creatives">
                      {m.creatives.map((c, i) => (
                        <CreativeCard
                          key={i}
                          c={c}
                          blocker={blocker(c)}
                          starting={starting === `${k}:${i}`}
                          busy={starting !== null}
                          jobs={(m.started[i] ?? []).map((id) => jobs.find((j) => j.id === id)).filter((j): j is Job => Boolean(j))}
                          wasStarted={Boolean(m.started[i])}
                          onStart={() => void start(k, i, c)}
                          onAdjust={() => p.onAdjust({
                            styleId: c.styleId, ...(c.wish ? { wish: c.wish } : {}), aspect: c.aspect, ...(c.duration !== undefined ? { duration: c.duration } : {}),
                            // The brief's product and avatar go along, like a start from here would take them.
                            ...(p.productImage ? { product: p.productImage } : {}),
                            ...(p.avatar && p.find(c.styleId)?.avatar !== "none" ? { avatar: p.avatar } : {}),
                          })}
                        />
                      ))}
                    </div>
                    {(() => {
                      const open = m.creatives.map((c, i) => ({ c, i })).filter(({ c, i }) => !m.started[i] && !blocker(c));
                      const sum = open.reduce((s, { c }) => s + (c.credits ?? 0), 0);
                      const tooMuch = me !== null && sum > me.credits;
                      return open.length > 1 ? (
                        <button type="button" className="go go--block ma-all" disabled={starting !== null || tooMuch} onClick={() => void startAll(k, m.creatives, m.started)} aria-label={`Start all ${open.length} for ${sum} Credits`}>
                          <span className="go__label">{tooMuch ? "Not enough Credits for all" : `Start all ${open.length}`}</span>
                          <span className="go__price"><TokenGlyph />{sum}</span>
                        </button>
                      ) : null;
                    })()}
                  </>
                )}
              </div>
            ))}
          </>
        )}
        {note && <p className="note note--error" role="alert">{note}</p>}
        <div ref={end} />
        <form className="ma-ask" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 2000))}
            rows={1}
            placeholder={empty ? "Describe freely: product, goal, channels …" : "Refine, e.g. “more video” or “claims in German”"}
            aria-label="Message to the Marketing Agent"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            disabled={!live}
          />
          {busy ? (
            <button type="button" className="ma-ask__btn" onClick={() => abort.current?.abort()} aria-label="Stop"><Square /></button>
          ) : (
            <button type="submit" className="ma-ask__btn" disabled={!input.trim() || !live} aria-label="Send"><ArrowUp /></button>
          )}
        </form>
      </div>
    </section>
  );
}

/** “tevyon-1a2b3c4d.png”: a download keeps the file's type. */
const fileName = (jobId: string, type: string) => `tevyon-${jobId.slice(0, 8)}.${{ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "image/svg+xml": "svg" }[type] ?? type.split("/")[1] ?? "bin"}`;

function CreativeCard({ c, blocker, starting, busy, jobs, wasStarted, onStart, onAdjust }: {
  c: Creative; blocker: string | null; starting: boolean; busy: boolean; jobs: Job[]; wasStarted: boolean; onStart: () => void; onAdjust: () => void;
}) {
  const preview = usePreview();
  const [copied, setCopied] = useState(false);
  const done = jobs.find((j) => j.status === "succeeded" && j.outputs[0]);
  const failed = jobs.length > 0 && jobs.every((j) => j.status === "failed");
  const running = jobs.some((j) => j.status === "queued" || j.status === "running");
  const out = done?.outputs[0];
  return (
    <article className="ma-card">
      <div className="ma-card__media">
        {out ? (
          out.contentType.startsWith("video/")
            ? <LoopVideo src={out.url} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={out.url} alt={c.title} />
        ) : <Cover src={c.cover} alt="" />}
        {running && <span className="ma-card__state"><span className="ring" aria-hidden="true" /> {jobs.some((j) => j.status === "running") ? "Creating …" : "Queued …"}</span>}
        {failed && <span className="ma-card__state ma-card__state--err">{JOB_ERROR[jobs[0]!.error ?? ""] ?? "Failed. Credits refunded."}</span>}
        <span className="ma-card__kind">{CATEGORY_ICON[c.category]}{c.kind === "video" ? <Play /> : null}</span>
        {done && <PreviewButton onOpen={() => preview.openJobs([done.id])} />}
      </div>
      <div className="ma-card__body">
        <h3 className="ma-card__title">{c.title}</h3>
        <p className="ma-card__specs"><AspectBox value={c.aspect} />{c.aspect}{c.duration !== undefined && ` · ${c.duration} s`}</p>
        {c.wish && <p className="ma-card__wish"><span>{c.spoken ? "Says" : c.lettering ? "Text" : "Scene"}</span>{c.wish}</p>}
        <p className="ma-card__why">{c.why}</p>
        {c.caption && (
          <div className="ma-card__caption">
            <p>{c.caption}</p>
            <button type="button" className="ms-mini" onClick={() => { void navigator.clipboard?.writeText(c.caption!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} aria-label="Copy caption">
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Caption"}
            </button>
          </div>
        )}
        <div className="ma-card__actions">
          {out ? (
            <a className="ms-mini" href={out.url} download={fileName(done!.id, out.contentType)}><Download /> Download</a>
          ) : wasStarted && !failed ? null : (
            <button type="button" className="go go--block" disabled={Boolean(blocker) || busy} onClick={onStart} aria-label={blocker ?? `${failed ? "Start again" : "Start"}: ${c.credits} Credits`}>
              <span className="go__label">{starting ? "Starting …" : blocker ?? (failed ? "Retry" : "Start")}</span>
              <span className="go__price"><TokenGlyph />{c.credits ?? "–"}</span>
            </button>
          )}
          <button type="button" className="ms-mini" onClick={onAdjust}><SlidersHorizontal /> Adjust in the editor</button>
        </div>
      </div>
    </article>
  );
}
