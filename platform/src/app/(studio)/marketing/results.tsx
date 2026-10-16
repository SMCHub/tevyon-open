"use client";

import { useEffect, useState } from "react";
import { EyeOff, FolderMinus, RotateCcw, SlidersHorizontal } from "lucide-react";
import { JobCard } from "@/components/studio/job-views";
import { LoopVideo } from "@/components/studio/loop-video";
import type { Job } from "@/components/studio/studio-context";
import { TokenGlyph } from "@/components/studio/tachyon-token";
import { filterResults, quoteBody, repeatable, runOf, startBody, type Chain, type Run, type Style } from "./data";
import { GAgent, GArrow, GCardsLarge, GCardsSmall, GPlay, GStar } from "./icons";
import { ToProject, type ProjectsApi } from "./projects";

export type StartResponse = {
  ok: boolean; error?: string; credits?: number; jobs?: { id: string }[]; partial?: string;
  next?: { styleId: string; wish: string; duration: number; aspect: string; credits: number };
};

type Props = {
  title: string;
  /** Replaces the title block (an open project shows its own head). */
  head?: React.ReactNode;
  jobs: Job[];
  find: (styleId: string) => Style | undefined;
  favorites: string[];
  onFavorite: (id: string) => void;
  onOpen: (list: Job[], index: number) => void;
  onAdjust: (run: Run) => void;
  /** “Animate”: a finished image as the product of a Motion run; returns an error text or null. */
  onAnimate?: (jobId: string) => Promise<string | null>;
  /** “To project” on every result; in an open project also “Remove”. */
  projects?: ProjectsApi;
  onToProject?: (jobId: string, projectId: string | "new") => void;
  inProject?: string;
  onRemoveFromProject?: (jobId: string) => void;
  onStarted: (res: StartResponse) => Promise<void>;
  errorText: (code: string | undefined) => string;
  waiting: Chain[];
  chainErrors: Chain[];
  empty: { icon: React.ReactNode; text: string; action?: { label: string; run: () => void } };
};

/** How this viewer likes the list: failed runs hidden, cards small or large (this browser only). */
const VIEW_KEY = "tachyon:ma:results";
type ListView = { hideFailed: boolean; size: "large" | "small" };

/** “My generations” and “Favourites”: results with download, favourite, adjust, animate and run again. */
export function Results(p: Props) {
  const [media, setMedia] = useState<"all" | "image" | "video">("all");
  const [look, setLook] = useState<ListView>({ hideFailed: false, size: "large" });
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<ListView> | null;
      if (v) setLook({ hideFailed: v.hideFailed === true, size: v.size === "small" ? "small" : "large" });
    } catch {}
  }, []);
  function changeLook(patch: Partial<ListView>) {
    setLook((v) => {
      const n = { ...v, ...patch };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(n));
      } catch {}
      return n;
    });
  }
  const isVideo = (j: Job) => Boolean(p.find(runOf(j.params)?.styleId ?? "")?.kind === "video" || j.outputs[0]?.contentType.startsWith("video/"));
  const list = filterResults(p.jobs, { media, hideFailed: look.hideFailed }, isVideo);
  const running = p.jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const failed = p.jobs.filter((j) => j.status === "failed").length;
  return (
    <section className="ms-explore" aria-label={p.title}>
      {p.head}
      <div className="ms-explore__head ms-explore__head--row">
        {!p.head && (
          <div>
            <h2 className="ms-explore__title">{p.title}</h2>
            <p className="ms-fine">{p.jobs.length} {p.jobs.length === 1 ? "result" : "results"}{running ? ` · ${running} in progress` : ""} · all also under Assets</p>
          </div>
        )}
        <div className="ma-results-tools">
          <div className="ms-chips" role="radiogroup" aria-label="Media type">
            {([["all", "All"], ["image", "Images"], ["video", "Videos"]] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={media === v} className={`ms-chip${media === v ? " is-on" : ""}`} onClick={() => setMedia(v)}>
                {l}
              </button>
            ))}
          </div>
          {(failed > 0 || look.hideFailed) && (
            <button type="button" className={`ms-chip${look.hideFailed ? " is-on" : ""}`} aria-pressed={look.hideFailed} onClick={() => changeLook({ hideFailed: !look.hideFailed })} title="Hide failed runs (their Credits are back)">
              <EyeOff /> Hide failed{failed > 0 && <span className="ms-chip__n">{failed}</span>}
            </button>
          )}
          <div className="ma-media ma-media--glyphs" role="radiogroup" aria-label="Card size">
            <button type="button" role="radio" aria-checked={look.size === "large"} className={look.size === "large" ? "is-on" : ""} onClick={() => changeLook({ size: "large" })} aria-label="Large cards" title="Large cards"><GCardsLarge /></button>
            <button type="button" role="radio" aria-checked={look.size === "small"} className={look.size === "small" ? "is-on" : ""} onClick={() => changeLook({ size: "small" })} aria-label="Small cards" title="Small cards"><GCardsSmall /></button>
          </div>
        </div>
      </div>
      {p.waiting.length > 0 && (
        <p className="ms-chain-note" role="status"><span className="ring" aria-hidden="true" /> {p.waiting.length === 1 ? "A UGC video is being made" : `${p.waiting.length} UGC videos are being made`}: first the still, then it speaks. Keep the page open until the video starts.</p>
      )}
      {p.chainErrors.map((c) => (
        <p key={c.frameJobId} className="note note--error" role="alert">The UGC video for the still could not start: {p.errorText(c.error)}</p>
      ))}
      {list.length ? (
        <div className={`grid-video ms-results${look.size === "small" ? " ms-results--small" : ""}`}>
          {list.map((j, i) => {
            const run = runOf(j.params);
            const style = run ? p.find(run.styleId) : undefined;
            const fav = p.favorites.includes(j.id);
            return (
              <div key={j.id} className="ms-result">
                <div className="ms-result__media">
                  <JobCard job={j} onOpen={() => p.onOpen(list, i)} />
                  <button type="button" className={`icon-btn ms-fav${fav ? " is-on" : ""}`} aria-pressed={fav} aria-label={fav ? "Remove from favourites" : "Add to favourites"} onClick={() => p.onFavorite(j.id)}>
                    <GStar />
                  </button>
                </div>
                <div className="ms-result__bar">
                  <span className="ms-result__title" title={style?.title}>{style?.title ?? "Marketing Agent"}{run?.wish ? <em> · {run.wish}</em> : null}</span>
                  {run && style && (
                    <span className="ms-result__actions">
                      <button type="button" className="ms-mini" onClick={() => p.onAdjust(run)} title="Load the settings into the editor"><SlidersHorizontal /> Adjust</button>
                      {repeatable(run, style) && !run.avatar && <Repeat run={run} style={style} onStarted={p.onStarted} errorText={p.errorText} />}
                      {p.onAnimate && j.status === "succeeded" && /^image\/(png|jpeg|webp)$/.test(j.outputs[0]?.contentType ?? "") && <Animate jobId={j.id} onAnimate={p.onAnimate} />}
                      {p.projects && p.onToProject && !p.inProject && <ToProject jobId={j.id} api={p.projects} onAdd={(target) => p.onToProject!(j.id, target)} />}
                      {p.inProject && p.onRemoveFromProject && (
                        <button type="button" className="ms-mini" onClick={() => p.onRemoveFromProject!(j.id)} title="Take out of this project (the generation stays)"><FolderMinus /> Remove</button>
                      )}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : p.jobs.length ? (
        <div className="empty empty--compact">
          <p>{look.hideFailed && failed > 0 && media === "all" ? "There are only failed runs here, and they are hidden." : `No ${media === "video" ? "videos" : media === "image" ? "images" : "results"} in this list.`}</p>
          {look.hideFailed && <button type="button" className="btn" onClick={() => changeLook({ hideFailed: false })}>Show failed</button>}
        </div>
      ) : (
        <div className="empty">
          {p.empty.icon}
          <p>{p.empty.text}</p>
          {p.empty.action && <button type="button" className="btn glass" onClick={p.empty.action.run}><GAgent /> {p.empty.action.label}</button>}
        </div>
      )}
    </section>
  );
}

/**
 * “Again”: the same run once more. The first click asks for today's price, the second starts at exactly that price
 * (a higher one starts nothing). Runs with an avatar go through “Adjust”, where the consent is asked again.
 */
function Repeat({ run, style, onStarted, errorText }: { run: Run; style: Style; onStarted: (res: StartResponse) => Promise<void>; errorText: (c: string | undefined) => string }) {
  const [state, setState] = useState<{ step: "idle" | "pricing" | "confirm" | "starting"; price?: number; error?: string }>({ step: "idle" });
  async function price() {
    setState({ step: "pricing" });
    const r = await fetch("/api/marketing/quote", { method: "POST", body: JSON.stringify(quoteBody(run, style)) }).catch(() => undefined);
    const q = (await r?.json().catch(() => undefined)) as { ok: boolean; credits?: number; error?: string } | undefined;
    if (!q?.ok || q.credits === undefined) return setState({ step: "idle", error: errorText(q?.error) });
    setState({ step: "confirm", price: q.credits });
  }
  async function start() {
    setState((s) => ({ ...s, step: "starting" }));
    const r = await fetch("/api/marketing", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(startBody(run, style, { count: 1, maxCredits: state.price ?? null })),
    }).catch(() => undefined);
    const res = (await r?.json().catch(() => undefined)) as StartResponse | undefined;
    if (!res?.ok) {
      if (res?.error === "price_changed" && res.credits !== undefined) return setState({ step: "confirm", price: res.credits, error: `New price: ${res.credits} Credits.` });
      return setState({ step: "idle", error: errorText(res?.error) });
    }
    setState({ step: "idle" });
    await onStarted(res);
  }
  return (
    <>
      {state.step === "confirm" || state.step === "starting" ? (
        <button type="button" className="ms-mini ms-mini--go" onClick={start} disabled={state.step === "starting"} aria-label={`Start again for ${state.price} Credits`}>
          {state.step === "starting" ? <span className="ring ring--dark" aria-hidden="true" /> : <RotateCcw />} Start · <TokenGlyph />{state.price}
        </button>
      ) : (
        <button type="button" className="ms-mini" onClick={price} disabled={state.step === "pricing"} title="The same settings once more">
          {state.step === "pricing" ? <span className="ring" aria-hidden="true" /> : <RotateCcw />} Again
        </button>
      )}
      {state.error && <span className="ms-result__err" role="alert">{state.error}</span>}
    </>
  );
}

/** “Animate”: copies the image and opens a Motion run with it (price first, nothing starts on its own). */
function Animate({ jobId, onAnimate }: { jobId: string; onAnimate: (jobId: string) => Promise<string | null> }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  return (
    <>
      <button
        type="button"
        className="ms-mini"
        disabled={state.busy}
        title="This image as a video: in motion, with sound"
        onClick={async () => {
          setState({ busy: true });
          const error = await onAnimate(jobId);
          setState({ busy: false, ...(error ? { error } : {}) });
        }}
      >
        {state.busy ? <span className="ring" aria-hidden="true" /> : <GPlay />} Animate
      </button>
      {state.error && <span className="ms-result__err" role="alert">{state.error}</span>}
    </>
  );
}

/** “Recently created” at the top of the stage: the newest runs with their live state, one click to the large view. */
export function RecentStrip({ jobs, find, onOpen, onAll, waiting }: { jobs: Job[]; find: (styleId: string) => Style | undefined; onOpen: (i: number) => void; onAll: () => void; waiting: number }) {
  if (!jobs.length) return null;
  return (
    <section className="ma-recent" aria-label="Recently created">
      <header className="ma-recent__head">
        <h2>Recently created</h2>
        {waiting > 0 && <span className="ma-recent__live"><span className="ring" aria-hidden="true" /> {waiting === 1 ? "UGC video in progress" : `${waiting} UGC videos in progress`}</span>}
        <button type="button" className="ma-link" onClick={onAll}>All generations<GArrow /></button>
      </header>
      <div className="ma-recent__row">
        {jobs.map((j, i) => {
          const run = runOf(j.params);
          const out = j.outputs[0];
          const busy = j.status === "queued" || j.status === "running";
          return (
            <button key={j.id} type="button" className={`ma-recent__card is-${j.status}`} onClick={() => onOpen(i)} aria-label={`Open ${find(run?.styleId ?? "")?.title ?? "result"}`}>
              {/* .ma-recent__item is a photo surface (dark tokens in globals.css); the name under it follows the page. */}
              <span className="ma-recent__item">
                {out && j.status === "succeeded" ? (
                  out.contentType.startsWith("video/")
                    ? <LoopVideo src={out.url} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={out.url} alt="" loading="lazy" />
                ) : (
                  <span className="ma-recent__state">{busy ? <><span className="ring" aria-hidden="true" />{j.status === "queued" ? "Waiting" : "Creating"}</> : "Failed"}</span>
                )}
              </span>
              <span className="ma-recent__label">{find(run?.styleId ?? "")?.title ?? "Marketing Agent"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
