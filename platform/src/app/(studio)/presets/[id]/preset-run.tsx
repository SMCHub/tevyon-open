"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock, Dices, Download, Expand, ImageUp, RefreshCw, Sparkles, X } from "lucide-react";
import { JOB_ERROR } from "@/components/studio/content";
import { recipeOf } from "@/components/studio/job-views";
import { LoopVideo } from "@/components/studio/loop-video";
import { PreviewButton, usePreview } from "@/components/studio/media-preview";
import { TokenGlyph } from "@/components/studio/tachyon-token";
import { usePresets, type PresetInfo } from "@/components/studio/presets-data";
import { presetEntry } from "@/components/studio/preview";
import { GpConsent, GpFooter, GpStep } from "@/components/studio/gen-panel";
import { useStudio, type Job } from "@/components/studio/studio-context";
import { uploadImage } from "@/components/studio/upload";
import { useMediaPicker } from "@/components/studio/media-picker";
import "./preset-run.css";

const WAIT_LINES = [
  "Setting the lights…",
  "Camera rolling…",
  "Shooting the scene…",
  "Firing the effects…",
  "Grading the colours…",
  "Almost there…",
];


/** Monochrome sparks for the reveal: pure CSS, no library. */
function Sparks() {
  const sparks = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => ({
        x: (Math.random() - 0.5) * 520,
        y: -(140 + Math.random() * 320),
        r: (Math.random() - 0.5) * 720,
        d: 0.6 + Math.random() * 0.7,
        delay: Math.random() * 0.15,
        size: 4 + Math.random() * 7,
        shade: ["#f5f5f2", "#ffffff", "#9a9a9f", "#d8d8d4"][i % 4],
      })),
    [],
  );
  return (
    <span className="sparks" aria-hidden="true">
      {sparks.map((s, i) => (
        <span
          key={i}
          style={{
            "--x": `${s.x}px`, "--y": `${s.y}px`, "--r": `${s.r}deg`, "--d": `${s.d}s`, "--delay": `${s.delay}s`,
            width: s.size, height: s.size * (i % 3 === 0 ? 2.4 : 1), background: s.shade,
          } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

const STATUS_LABEL: Record<Job["status"], string> = { queued: "Queued", running: "In progress", succeeded: "Done", failed: "Failed" };

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function when(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "Today" : d.toLocaleDateString("en-US")}, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

/** The chosen run large in its own format, with what it was made from and what to do with it. */
function RunView({ job, onAgain, onPreview, busy, wishLabel }: { job: Job; onAgain?: () => void; onPreview: () => void; busy: boolean; wishLabel: string }) {
  const [line, setLine] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const done = job.status === "succeeded";
  const running = job.status === "queued" || job.status === "running";
  const [revealed, setRevealed] = useState(done);
  const wasRunning = useRef(!done);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setLine((l) => (l + 1) % WAIT_LINES.length);
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (done) setRevealed(true);
  }, [done]);

  const out = job.outputs[0];
  const isVideo = out?.contentType.startsWith("video/") ?? true;
  const ratio = String(job.params.aspect_ratio ?? "9:16").replace(":", " / ");
  const wish = recipeOf(job)?.wish;
  const seconds = typeof job.params.duration === "number" ? job.params.duration : null;
  return (
    <div className={`prun${done && wasRunning.current ? " run--reveal" : ""}`}>
      <div className="run__frame prun__frame" style={{ aspectRatio: ratio }}>
        {done && out ? (
          isVideo ? (
            <video className="run__media" src={out.url} autoPlay loop playsInline controls />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="run__media" src={out.url} alt="Your result" />
          )
        ) : job.status === "failed" ? (
          <div className="run__state run__state--failed">{JOB_ERROR[job.error ?? ""] ?? "Failed. Credits refunded."}</div>
        ) : (
          <div className="run__state">
            <span className="run__orb" aria-hidden="true" />
            <span className="run__line" aria-live="polite">{WAIT_LINES[Math.floor(line / 3) % WAIT_LINES.length]}</span>
            <span className="run__hint">Running for {clock(now - job.createdAt)} · usually under a minute</span>
          </div>
        )}
        {done && revealed && wasRunning.current && <Sparks />}
        {done && wasRunning.current && <span className="run__shine" aria-hidden="true" />}
        {done && out && <PreviewButton onOpen={onPreview} />}
      </div>

      <aside className="prun__info" aria-label="Run details">
        <span className={`prun__status prun__status--${job.status}`}>{running && <span className="live-dot" aria-hidden="true" />}{STATUS_LABEL[job.status]}</span>
        <dl className="prun__facts">
          {wish && (
            <div className="prun__fact prun__fact--wide">
              <dt>{wishLabel}</dt>
              <dd>“{wish}”</dd>
            </div>
          )}
          <div className="prun__fact"><dt>Created</dt><dd>{when(job.createdAt)}</dd></div>
          <div className="prun__fact"><dt>{job.status === "failed" ? "Credits" : "Price"}</dt><dd>{job.status === "failed" ? "refunded" : <><TokenGlyph />{job.credits}</>}</dd></div>
          {seconds !== null && <div className="prun__fact"><dt>Length</dt><dd>{seconds} s{job.params.generate_audio ? " · with sound" : ""}</dd></div>}
          <div className="prun__fact"><dt>Format</dt><dd>{String(job.params.aspect_ratio ?? "9:16")}</dd></div>
        </dl>
        <div className="prun__actions">
          {done && out && (
            <a className="btn glass prun__btn" href={out.url} download={`tevyon-${job.id.slice(0, 8)}.${isVideo ? "mp4" : "jpg"}`}><Download aria-hidden="true" /> Download</a>
          )}
          {done && out && <button type="button" className="btn prun__btn" onClick={onPreview}><Expand aria-hidden="true" /> View large</button>}
          {onAgain && (
            <button type="button" className="btn prun__btn" onClick={onAgain} disabled={busy || running} title={`Same photo, same text, a new run for ${job.credits} Credits`}>
              <RefreshCw aria-hidden="true" /> Again with the same inputs
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * Fan of example clips: this preset in the middle, two neighbours of the same category on each side.
 * Only the centre plays; the sides are posters (video budget), a click opens that preset.
 */
function PresetFan({ preset, siblings }: { preset: PresetInfo; siblings: PresetInfo[] }) {
  const preview = usePreview();
  const left = siblings.slice(0, 2).reverse();
  const right = siblings.slice(2, 4);
  const side = (p: PresetInfo, pos: string) => (
    <Link key={p.id} href={`/presets/${p.id}`} className={`fan__card fan__card--${pos}`} aria-label={p.title} title={p.title}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.preview.poster} alt="" loading="lazy" decoding="async" />
    </Link>
  );
  return (
    <div className="fan">
      {left.map((p, i) => side(p, i === 0 ? "l2" : "l1"))}
      <div className="fan__card fan__card--c">
        <LoopVideo src={preset.preview.video} poster={preset.preview.poster} />
        <span className="fan__label">Example</span>
        <PreviewButton onOpen={() => preview.openEntries([preset, ...siblings].map(presetEntry))} />
      </div>
      {right.map((p, i) => side(p, i === 0 ? "r1" : "r2"))}
    </div>
  );
}

const NEED: Record<"photo" | "product" | "place", { label: string; hint: string; short: string }> = {
  photo: { label: "Your photo", hint: "Face clearly visible, portrait format is best", short: "One photo" },
  product: { label: "Your product photo", hint: "Product clearly visible, calm background", short: "One product photo" },
  place: { label: "Photo of the room", hint: "Whole room in frame, good daylight", short: "One room photo" },
};

export function PresetRun({ id }: { id: string }) {
  const router = useRouter();
  const preview = usePreview();
  const presets = usePresets();
  const { me, jobs, refresh } = useStudio();
  const preset = presets.find((p) => p.id === id);

  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [wish, setWish] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<string[]>([]);
  const [view, setView] = useState<"examples" | "runs" | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  // Remember this session's runs per preset, so a reload keeps them visible.
  // Read on mount, write only when a run starts (an effect would write the empty first render back).
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`tachyon:runs:${id}`) ?? "[]") as string[];
      setRuns(saved);
    } catch {}
  }, [id]);
  function addRun(jobId: string) {
    setRuns((list) => {
      const next = [jobId, ...list];
      try {
        sessionStorage.setItem(`tachyon:runs:${id}`, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  // Neighbours for the fan: same category first, then the rest.
  const siblings = useMemo(() => {
    if (!preset) return [];
    const others = presets.filter((p) => p.id !== preset.id);
    return [...others.filter((p) => p.category === preset.category), ...others.filter((p) => p.category !== preset.category)].slice(0, 4);
  }, [presets, preset]);

  // A click opens earlier uploads and results beside the field; a new file is uploaded (and scanned) as before.
  const picker = useMediaPicker({ kind: "image", onPick: ([url]) => url && setImage(url), onFiles: ([f]) => f && void upload(f) });

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    // Shared upload: large photos are scaled down in the browser first (hosting takes at most 4.5 MB per request).
    const res = await uploadImage(file);
    setUploading(false);
    if ("error" in res) return setError(res.error);
    setImage(res.url);
  }

  /** Starts the preset with the panel's photo and wish, or (run again) with those of an earlier run. */
  async function generate(from?: { image: string; wish?: string }) {
    const useImage = from?.image ?? image;
    const useWish = from ? from.wish ?? "" : wish;
    // Run again repeats a start the user already confirmed consent for; a new photo needs the checkbox.
    if (!useImage || (!from && !consent) || busy) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/presets/${id}`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      // The price on the button is the price the user agreed to (price guarantee); a higher price starts nothing.
      body: JSON.stringify({ image: useImage, wish: useWish.trim() || undefined, consent: true, ...(preset?.credits != null ? { maxCredits: preset.credits } : {}) }),
    });
    const res = (await r.json()) as { ok: boolean; error?: string; credits?: number; job?: { id: string } };
    setBusy(false);
    if (!res.ok) {
      return setError(res.error === "price_changed" && res.credits !== undefined
        ? `The price just changed: now ${res.credits} Credits. Reload the page to confirm it.`
        : JOB_ERROR[res.error ?? ""] ?? "Could not start.");
    }
    addRun(res.job!.id);
    setPicked(res.job!.id);
    setView("runs");
    await refresh();
  }

  function surprise() {
    const others = presets.filter((p) => p.id !== id);
    const pick = others[Math.floor(Math.random() * others.length)];
    if (pick) router.push(`/presets/${pick.id}`);
  }

  // Every run of this preset from the account's jobs (server truth, survives reloads and other tabs), newest first;
  // runs started in this tab count even before the job list has them.
  const runJobs = useMemo(() => {
    const mine = jobs.filter((j) => recipeOf(j)?.id === id || runs.includes(j.id));
    return [...new Map(mine.map((j) => [j.id, j])).values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [jobs, runs, id]);
  // Open on "Your runs" while one is running or the last one is from the past hour; otherwise on the examples.
  const recent = runJobs[0] && (runJobs[0].status === "queued" || runJobs[0].status === "running" || Date.now() - runJobs[0].createdAt < 3_600_000);
  const active = runJobs.length && (view === "runs" || (view === null && recent)) ? "runs" : "examples";
  const current = runJobs.find((j) => j.id === picked) ?? runJobs[0];
  const tooExpensive = me !== null && preset?.credits != null && preset.credits > me.credits;
  const line = preset?.line ?? null;
  const canGo = Boolean(image && consent && !busy && !uploading && !tooExpensive && (!line || wish.trim()));
  const need = NEED[preset?.needs ?? "photo"];
  const missing = !image ? (uploading ? "Uploading…" : "Photo missing")
    : line && !wish.trim() ? `${line.label} missing`
    : !consent ? "Consent missing"
    : tooExpensive ? "Not enough Credits"
    : null;

  if (presets.length && !preset) {
    return (
      <div className="studio"><div className="empty"><p>This preset does not exist.</p><Link className="btn" href="/presets">All presets</Link></div></div>
    );
  }

  return (
    <div className="studio studio--preset">
      <aside className="panel preset-panel gp" aria-label="Run preset">
        <div className="prp-top">
          <Link href="/presets" className="preset-panel__back"><ArrowLeft aria-hidden="true" /> All presets</Link>
          <button type="button" className="prp-dice" onClick={surprise} aria-label="Roll another preset" title="Roll another preset">
            <Dices aria-hidden="true" />
          </button>
        </div>

        <div className="preset-panel__head prp-head">
          {preset && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="prp-head__poster" src={preset.preview.poster} alt="" />
          )}
          <div className="prp-head__text">
            <span className="preset-panel__kicker">Preset{preset?.credits != null ? ` · ${preset.credits} Credits` : ""}</span>
            <span className="preset-panel__name">{preset?.title ?? "…"}</span>
            {preset && <span className="prp-head__tagline">{preset.tagline}</span>}
          </div>
        </div>

        <GpStep n={1} title={need.label} meta="JPG, PNG, WebP" done={Boolean(image)}>
          <div
            className={`drop${drag ? " is-drag" : ""}${image ? " has-image" : ""}`}
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-expanded={picker.isOpen}
            onClick={(e) => picker.open(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              picker.open(e.currentTarget);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) upload(f);
            }}
          >
            {image ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="Your photo" />
                <span className="drop__swap">Replace</span>
                <PreviewButton className="pv-open--beside" onOpen={() => preview.openEntries([{ url: image, kind: "image", chip: "Your upload", title: need.label }])} />
                <button
                  type="button"
                  className="icon-btn drop__clear"
                  aria-label="Remove photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    setImage(null);
                  }}
                >
                  <X />
                </button>
              </>
            ) : (
              <span className="drop__empty">
                <span className="drop__icon">{uploading ? <span className="ring" aria-hidden="true" /> : <ImageUp aria-hidden="true" />}</span>
                <span className="drop__text">
                  <span className="drop__title">{uploading ? "Uploading and checking…" : "Upload photo"}</span>
                  <span className="drop__sub">{need.hint}</span>
                </span>
              </span>
            )}
            <span onClick={(e) => e.stopPropagation()}>{picker.el}</span>
          </div>
        </GpStep>

        {line ? (
          <GpStep n={2} title={line.label} meta={`${wish.length}/120`} done={Boolean(wish.trim())}>
            <input className="wish" value={wish} maxLength={120} required onChange={(e) => setWish(e.target.value)} placeholder={line.placeholder} />
            <span className="prp-hint">Spoken in the clip, about 8 seconds.</span>
          </GpStep>
        ) : (
          <GpStep n={2} title="Your wish" meta="optional" done={Boolean(wish.trim())}>
            <input className="wish" value={wish} maxLength={200} onChange={(e) => setWish(e.target.value)} placeholder={preset?.wishHint ?? "e.g. in a golden ballroom"} />
          </GpStep>
        )}

        <GpConsent checked={consent} onChange={setConsent}>
          {preset?.needs !== "photo" ? "I hold the rights to this image. Anyone shown has agreed." : "I am in the photo or have the consent of everyone shown."}
        </GpConsent>

        <GpFooter
          summary={preset ? `${need.short} · one click · finished clip` : undefined}
          label="Generate"
          busy={busy}
          missing={busy ? null : missing}
          price={preset?.credits ?? null}
          disabled={!canGo}
          onGo={() => generate()}
          notice={error ? <p className="note note--error" role="alert">{error}</p> : null}
        />
      </aside>

      <section className="preset-stage" aria-label={preset?.title ?? "Preset"}>
        <div className="preset-stage__tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={active === "examples"} className="preset-stage__tab" onClick={() => setView("examples")}>
            <Sparkles aria-hidden="true" /> Examples
          </button>
          <button type="button" role="tab" aria-selected={active === "runs"} className="preset-stage__tab" onClick={() => setView("runs")} disabled={!runJobs.length}>
            <Clock aria-hidden="true" /> Your runs{runJobs.length ? <span className="count">{runJobs.length}</span> : null}
          </button>
        </div>

        <div className="preset-stage__body">
          {active === "runs" && current ? (
            <>
              <RunView key={current.id} job={current} busy={busy || tooExpensive} wishLabel={line?.label ?? "Your wish"}
                onAgain={typeof current.params.image === "string" ? () => generate({ image: current.params.image as string, ...(recipeOf(current)?.wish ? { wish: recipeOf(current)!.wish } : {}) }) : undefined}
                onPreview={() => preview.openJobs(runJobs.filter((j) => j.status === "succeeded").map((j) => j.id), Math.max(0, runJobs.filter((j) => j.status === "succeeded").findIndex((j) => j.id === current.id)))} />
              {runJobs.length > 1 && (
                <div className="prun__strip" aria-label="All runs">
                  {runJobs.map((j, i) => (
                    <button key={j.id} type="button" className={`prun__thumb prun__thumb--${j.status}${j.id === current.id ? " is-on" : ""}`} aria-label={`View run ${runJobs.length - i}`} aria-pressed={j.id === current.id} onClick={() => setPicked(j.id)}>
                      {j.status === "succeeded" && j.outputs[0]
                        ? (j.outputs[0].contentType.startsWith("video/") ? <LoopVideo src={j.outputs[0].url} /> : <img src={j.outputs[0].url} alt="" />)
                        : j.status === "failed" ? <X aria-hidden="true" /> : <span className="ring" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            preset && (
              <>
                <PresetFan preset={preset} siblings={siblings} />
                <div className="preset-stage__copy">
                  {preset.badge && <span className={`tag tag--${preset.badge}`}>{preset.badge === "top" ? "Top" : "New"}</span>}
                  <h1 className="preset-stage__title">{preset.title}</h1>
                  <p className="preset-stage__tagline">{preset.tagline}</p>
                  <p className="preset-stage__meta">{need.short} · one click{preset.credits != null ? ` · ${preset.credits} Credits` : ""}</p>
                </div>
              </>
            )
          )}
        </div>
      </section>
    </div>
  );
}
