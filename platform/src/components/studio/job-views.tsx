"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Clapperboard, Download, Globe, Image as ImageIcon, RotateCcw, Shuffle, TriangleAlert, Volume2, X } from "lucide-react";
import { VisibilityButton, useCommunity } from "./community";
import { visibilityOf } from "./community-view";
import { FAILED_TITLE, JOB_ERROR } from "./content";
import { chargeLine, startErrorText } from "./credits";
import { ratio, showValue, PARAM_LABEL } from "./schema";
import { useStudio, type Job } from "./studio-context";
import { LoopVideo } from "./loop-video";
import { CopyPrompt, MediaPreview, PreviewHint, PreviewStage, PromptText } from "./media-preview";
import { jobMedia } from "./preview";
import { jobAsReference } from "./references";
import { TokenGlyph } from "./tachyon-token";

/** Results that can serve as reference images (uploads accept no SVG or video). */
const RASTER = /^image\/(png|jpeg|webp)$/;
const isVideo = (j: Job) => j.outputs[0]?.contentType.startsWith("video/") ?? false;
const ext = (ct: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "video/mp4": "mp4" })[ct] ?? "bin";

function timeAgo(ms: number) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString("en-US");
}

/** Preset marker of a job from an older version (the recipe prompt itself never reaches the browser). */
export function recipeOf(job: Job): { id: string; title: string; wish?: string } | undefined {
  const r = job.params.recipe as { id?: unknown; title?: unknown; wish?: unknown } | undefined;
  return r && typeof r.id === "string" ? { id: r.id, title: String(r.title ?? r.id), ...(typeof r.wish === "string" ? { wish: r.wish } : {}) } : undefined;
}

/** One line that describes a job: its own prompt, or “Preset · wish” for a preset job. */
export function jobText(job: Job): string {
  const r = recipeOf(job);
  if (!r) return String(job.params.prompt ?? "");
  return `Preset ${r.title}${r.wish ? ` · ${r.wish}` : ""}`;
}

/** The visual of a job in any state; a finished video loops muted here, the preview plays it with sound. */
export function JobMedia({ job, fit = "cover", onRatio }: { job: Job; fit?: "cover" | "contain"; onRatio?: (r: number) => void }) {
  const out = job.outputs[0];
  if (job.status === "succeeded" && out) {
    return isVideo(job) ? (
      <LoopVideo className={`media media--${fit}`} src={out.url} onRatio={onRatio} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={`media media--${fit}`} src={out.url} alt={jobText(job)} loading="lazy" decoding="async" onLoad={(e) => onRatio?.(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
    );
  }
  if (job.status === "failed") {
    return (
      <div className="media-state media-state--failed" title={JOB_ERROR[job.error ?? ""] ?? "Failed. Credits refunded."}>
        <span className="failed__icon" aria-hidden="true"><TriangleAlert /></span>
        <span className="failed__title">{FAILED_TITLE[job.error ?? ""] ?? "Didn't work"}</span>
        <span className="failed__refund"><RotateCcw aria-hidden="true" />{job.credits} Credits refunded</span>
      </div>
    );
  }
  return (
    <div className="media-state media-state--busy">
      <span className="shimmer" aria-hidden="true" />
      <span className="media-state__label"><span className="ring" aria-hidden="true" />{job.status === "queued" ? "In the queue" : "Generating …"}</span>
    </div>
  );
}

/** The quiet mark at a result tile's foot, as on the walls' Shot: “Seedream 4.5 · Format 3:4”. */
function cardFacts(job: Job): string {
  // No “Video” mark on the tile; the length goes here.
  const ar = job.params.aspect_ratio;
  const seconds = isVideo(job) && job.params.duration ? `${job.params.duration} s` : null;
  return [job.model, typeof ar === "string" && ar.includes(":") ? `Format ${ar}` : null, seconds].filter(Boolean).join(" · ");
}

/**
 * A result tile, built like the walls' Shot (wall.tsx): the picture at rest with small marks top left (sound,
 * shared), on hover or focus one quiet mark at the foot, no shade and no buttons; a click opens the Lightbox,
 * which holds every action (download, reuse, @, variant, share). `layout="masonry"` keeps the job's own aspect ratio
 * (measured once the file loads).
 */
export function JobCard({ job, onOpen, layout = "masonry" }: { job: Job; onOpen: () => void; layout?: "masonry" | "square" }) {
  const { kindOf } = useStudio();
  const [natural, setNatural] = useState<number | null>(null);
  const kind = kindOf(job.jobType) ?? "image";
  const declared = job.params.aspect_ratio ?? (kind === "video" ? "16:9" : undefined);
  const aspect = layout === "square" ? 1 : natural ?? (declared ? ratio(declared) : 1);
  const done = job.status === "succeeded";
  // Shared in the community: a globe at rest; the switch itself sits in the Lightbox.
  const { mine } = useCommunity();
  const shared = visibilityOf(mine, job.id) === "public";
  return (
    <article className={`card card--${job.status}`} style={{ aspectRatio: String(aspect) }}>
      <button type="button" className="card__hit" onClick={onOpen} aria-label={`Open: ${jobText(job) || job.model}`}>
        <JobMedia job={job} onRatio={layout === "masonry" ? (r) => Number.isFinite(r) && r > 0 && setNatural(r) : undefined} />
      </button>
      {done && (
        <span className="card__chips" aria-hidden="true">
          {shared && <span className="card__chip card__chip--public" title="In the Community"><Globe /></span>}
          {job.params.generate_audio === true && <span className="card__chip"><Volume2 /></span>}
        </span>
      )}
      {done && <span className="card__facts" aria-hidden="true"><span className="card__chip">{cardFacts(job)}</span></span>}
    </article>
  );
}

/** Full-screen view of one job with its details in the studio's media preview (video with sound); arrows and Escape work. */
export function Lightbox({ jobs, index, onClose, onIndex }: { jobs: Job[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const router = useRouter();
  const { kindOf, start, quote } = useStudio();
  const [note, setNote] = useState<string | null>(null);
  const job = jobs[index];
  // A variant costs today's price for these settings, which can differ from what this job cost back then.
  const [variantPrice, setVariantPrice] = useState<number | null>(null);
  useEffect(() => {
    // Preset jobs (older versions) have no variant (their prompt stays on the server): nothing to price.
    if (!job || recipeOf(job)) return;
    let live = true;
    setVariantPrice(null);
    quote(job.jobType, job.params).then((p) => live && setVariantPrice(p));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, quote]);

  if (!job) return null;
  const out = job.outputs[0];
  const media = jobMedia(job);
  const kind = kindOf(job.jobType) ?? "image";
  const recipe = recipeOf(job);
  // The consent a job carries is a yes, not a setting.
  const params = Object.entries(job.params).filter(([k]) => k !== "prompt" && k !== "recipe" && k !== "consent");
  // Image inputs (start frame, references) show as thumbnails, not as raw paths.
  const isRef = (v: unknown) => typeof v === "string" && (v.startsWith("/api/media/") || /^https?:\/\//.test(v) || v.startsWith("data:image/"));
  const refs = params.flatMap(([, v]) => (Array.isArray(v) ? v : [v])).filter(isRef) as string[];
  const specs = params.filter(([, v]) => !isRef(v) && !(Array.isArray(v) && v.some(isRef)));

  async function variant() {
    setNote(null);
    const res = await start(job!.jobType, job!.params, 1, { maxCredits: variantPrice ?? job!.credits });
    if (!res.ok && res.error === "price_changed" && res.credits !== undefined) setVariantPrice(res.credits);
    setNote(res.ok ? "Variant started. It will appear in your results." : startErrorText(res));
  }

  return (
    <MediaPreview
      label="Result"
      count={jobs.length}
      index={index}
      onIndex={onIndex}
      onClose={onClose}
      stage={media ? <PreviewStage media={media} alt={jobText(job)} /> : <JobMedia job={job} fit="contain" />}
      aside={<>
        <header className="lb-head">
          <span className="lb-chip">{kind === "video" ? <Clapperboard aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}{kind === "video" ? "Video" : "Image"}</span>
          <span className="lb-time">{timeAgo(job.createdAt)}</span>
          <button type="button" className="icon-btn lb-close" aria-label="Close" onClick={onClose}><X /></button>
        </header>
        <h2 className="lightbox__model">{job.model}</h2>

        {recipe ? (
          <section className="lb-prompt">
            <div className="lb-label">Preset</div>
            <p className="lb-recipe">{recipe.title}</p>
            {recipe.wish && <PromptText key={job.id} text={`Wish: ${recipe.wish}`} />}
          </section>
        ) : String(job.params.prompt ?? "").trim() ? (
          <section className="lb-prompt">
            <div className="lb-label">Prompt <CopyPrompt text={String(job.params.prompt ?? "")} /></div>
            <PromptText key={job.id} text={String(job.params.prompt ?? "")} />
          </section>
        ) : null}

        {refs.length > 0 && (
          <section className="lb-refs">
            <div className="lb-label">{Array.isArray(job.params.references) && job.params.references.length ? "Reference images" : "Start image"}</div>
            <div className="lb-refs__row">
              {refs.map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={u} src={u} alt="" className="lb-refs__img" loading="lazy" />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="lb-label">Settings</div>
          <dl className="lb-specs">
            {specs.map(([k, v]) => (
              <div key={k}><dt>{PARAM_LABEL[k] ?? k}</dt><dd title={showValue(k, v)}>{showValue(k, v)}</dd></div>
            ))}
            <div><dt>Credits</dt><dd>{chargeLine(job)}</dd></div>
          </dl>
        </section>

        {/* Pills wrap instead of overflowing: two share a row where they fit, a lone one or a long label takes the row. */}
        <div className="lb-actions">
          {out && (
            <a className="btn btn--primary" href={out.url} download={`tevyon-${job.id.slice(0, 8)}.${ext(out.contentType)}`}><Download aria-hidden="true" /><span className="lb-actions__label">Download</span></a>
          )}
          {!recipe && (
            <>
              <button type="button" className="btn" onClick={() => { onClose(); router.push(`/${kind}?from=${job.id}`); }}><RotateCcw aria-hidden="true" /><span className="lb-actions__label">Reuse</span></button>
              {out && RASTER.test(out.contentType) && (
                <button type="button" className="btn" onClick={async () => { const err = await jobAsReference(job.id, router.push); if (err) setNote(err); else onClose(); }}>
                  <AtSign aria-hidden="true" /><span className="lb-actions__label">As reference</span>
                </button>
              )}
              <button type="button" className="btn" onClick={variant} title={`New variant for ${variantPrice ?? job.credits} Credits`} aria-label={`New variant for ${variantPrice ?? job.credits} Credits`}>
                <Shuffle aria-hidden="true" /><span className="lb-actions__label">Variant</span><span className="lb-price"><TokenGlyph />{variantPrice ?? job.credits}</span>
              </button>
            </>
          )}
          {job.status === "succeeded" && out && <VisibilityButton jobId={job.id} className="btn" labelled />}
          {note && <p className="note" role="status">{note}</p>}
          <PreviewHint video={media?.kind === "video"} />
        </div>
      </>}
    />
  );
}
