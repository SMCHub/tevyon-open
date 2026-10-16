"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Maximize2, Wand2 } from "lucide-react";
import { NotEnough, priceText, startErrorText } from "@/components/studio/credits";
import { GpConsent, GpFooter, GpModel, GpModes, GpPrompt, GpStep } from "@/components/studio/gen-panel";
import { JobCard, Lightbox } from "@/components/studio/job-views";
import { Segmented } from "@/components/studio/segmented";
import { useStudio, type Job } from "@/components/studio/studio-context";
import { DropZone, useUpload, videoSecondsOf } from "@/components/studio/upload";
import { Columns, WallTitle } from "@/components/studio/wall";

type Tool = "edit" | "upscale";
type Factor = "1.5" | "2" | "3";
type Creativity = "precise" | "creative";

const TOOLS: Record<Tool, { jobType: string; title: string; cover: string; hint: string; empty: string; min: number; max: number }> = {
  edit: {
    jobType: "video_edit",
    title: "Video Edit",
    cover: "/presets/voiceover-ad.webp",
    hint: "1 to 15 seconds, MP4 or MOV",
    empty: "Upload a video on the left and describe one change. You get the same clip back with the change; motion and length stay.",
    min: 1,
    max: 15,
  },
  upscale: {
    jobType: "video_upscale",
    title: "Video Upscale",
    cover: "/presets/voiceover-ad.webp",
    hint: "1 to 20 seconds, MP4 or MOV",
    empty: "Upload a video on the left. You get it back larger and sharper, up to 4K, with the same length and motion.",
    min: 1,
    max: 20,
  },
};

/** One-click starts for the instruction: each fills the field. */
const EDIT_IDEAS: { label: string; text: string }[] = [
  { label: "Background", text: "Replace the background with a clean bright studio wall, keep everything else unchanged." },
  { label: "Remove", text: "Remove the <object> from the scene, fill the space naturally, keep everything else unchanged." },
  { label: "Replace", text: "Replace the <object> with <new object>, same position and size, keep everything else unchanged." },
  { label: "Recolour", text: "Recolour the <object> to <colour>, keep everything else unchanged." },
  { label: "Light", text: "Relight the scene with warm golden-hour sunlight from the left, keep everything else unchanged." },
];

/** Output stays within 4K on the long side (catalog.ts UPSCALE_MAX_LONG). */
const MAX_LONG = 3840;
const FACTORS: Factor[] = ["1.5", "2", "3"];
/** Size from an own upload's name ("…-1280x720_12s.mp4"); older uploads carry only the length. */
const sizeOf = (url: string | null) => {
  const m = url ? /-(\d{2,5})x(\d{2,5})_\d{1,3}s\.mp4$/.exec(url) : null;
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
};

const toolOf = (v: string | null): Tool => (v === "upscale" ? "upscale" : "edit");
const jobHeight = () => 1;
const jobKey = (j: Job) => j.id;

/**
 * Video tools (mega menu "Video": one page, the tool in the URL): edit your own clip with one instruction (video_edit)
 * or upscale it up to 4K (video_upscale). The page offers only the tools the register has; the price shows before the start. ?tool= picks the tool, ?video=<own upload> brings a clip,
 * ?from=<job> repeats one.
 */
export function VideoToolsStudio() {
  const router = useRouter();
  const search = useSearchParams();
  const { catalog, me, jobs, start, quote } = useStudio();
  const tool = toolOf(search.get("tool"));
  const copy = TOOLS[tool];
  const entry = catalog.find((c) => c.jobType === copy.jobType);

  const clip = useUpload("video");
  const [prompt, setPrompt] = useState("");
  const [factor, setFactor] = useState<Factor>("2");
  const [creativity, setCreativity] = useState<Creativity>("precise");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  // A clip handed over (?video=) or "Reuse" of a tool job (?from=): the same clip and settings again.
  const handed = search.get("video");
  const from = search.get("from");
  useEffect(() => {
    if (handed) clip.setUrl(handed);
    const j = from ? jobs.find((x) => x.id === from) : undefined;
    if (j && typeof j.params.video === "string") clip.setUrl(j.params.video);
    if (j && typeof j.params.prompt === "string") setPrompt(j.params.prompt);
    if (j && (j.params.factor === "1.5" || j.params.factor === "2" || j.params.factor === "3")) setFactor(j.params.factor);
    if (j && (j.params.creativity === "precise" || j.params.creativity === "creative")) setCreativity(j.params.creativity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handed, from, jobs.length > 0]);

  const seconds = clip.url ? videoSecondsOf(clip.url) : null;
  const lengthOk = seconds !== null && seconds >= copy.min && seconds <= copy.max;
  const size = sizeOf(clip.url);
  const long = size ? Math.max(size.width, size.height) : null;
  const fits = (f: Factor) => long !== null && long * Number(f) <= MAX_LONG;
  // A factor that would go past 4K is not offered; the largest that fits is taken instead.
  useEffect(() => {
    if (tool !== "upscale" || long === null || fits(factor)) return;
    const best = [...FACTORS].reverse().find(fits);
    if (best) setFactor(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, long]);

  const params = useMemo(() => {
    if (!clip.url || !lengthOk) return null;
    if (tool === "upscale") return size && fits(factor) ? { video: clip.url, factor, creativity, prompt: prompt.trim() } : null;
    return { video: clip.url, prompt: prompt.trim() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, clip.url, lengthOk, size?.width, factor, creativity, prompt]);

  // The price depends on clip and settings, not on the words: quote again only when those change.
  const priceKey = params ? JSON.stringify({ ...params, prompt: "" }) : null;
  useEffect(() => {
    let live = true;
    setPrice(null);
    if (params) quote(copy.jobType, tool === "edit" ? { ...params, prompt: (params.prompt as string).length >= 3 ? params.prompt : "edit the clip" } : params).then((p) => live && setPrice(p));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey, copy.jobType, quote]);

  const results = jobs.filter((j) => j.jobType === copy.jobType);
  const tooExpensive = me !== null && price !== null && price > me.credits;
  const missing = !entry ? "Tool not available"
    : !clip.url ? "Video missing"
    : clip.busy ? "Uploading…"
    : !lengthOk ? `Video ${copy.min}–${copy.max} s`
    : tool === "upscale" && !size ? "Upload the video again"
    : tool === "upscale" && !FACTORS.some(fits) ? "Video is already 4K"
    : tool === "edit" && prompt.trim().length < 3 ? "Change missing"
    : !consent ? "Consent missing"
    : tooExpensive ? "Not enough Credits"
    : null;
  const canGo = Boolean(entry && params && !missing && !busy && price !== null);

  async function generate() {
    if (!canGo || !params) return;
    setBusy(true);
    setError(null);
    const res = await start(copy.jobType, params, 1, price !== null ? { maxCredits: price } : {});
    setBusy(false);
    if (!res.ok) setError(startErrorText(res));
  }

  function choose(next: Tool) {
    if (next === tool) return;
    setError(null);
    const keep = clip.url ? `&video=${encodeURIComponent(clip.url)}` : "";
    router.replace(`/video/tools?tool=${next}${keep}`, { scroll: false });
  }

  const outSize = size ? `${Math.round(size.width * Number(factor))}×${Math.round(size.height * Number(factor))}` : null;

  return (
    <div className="studio studio--video">
      <aside className="panel gp gp--compact" aria-label={copy.title}>
        <GpModes
          label="Tool"
          value={tool}
          onChange={choose}
          modes={([
            { id: "edit" as const, label: "Edit", icon: <Wand2 aria-hidden="true" /> },
            { id: "upscale" as const, label: "Upscale", icon: <Maximize2 aria-hidden="true" /> },
          ]).filter((m) => m.id === tool || catalog.some((c) => c.jobType === TOOLS[m.id].jobType))}
        />
        <GpModel cover={copy.cover} name={entry?.model ?? copy.title} tagline={entry?.tagline} kicker="Tool" />

        <GpStep n={1} title="Video" meta={seconds !== null ? `${seconds} s${size ? ` · ${size.width}×${size.height}` : ""}` : `${copy.min}–${copy.max} s`} done={lengthOk}>
          <DropZone up={clip} title="Add video" hint={copy.hint} />
          {clip.error && <p className="note note--error" role="alert">{clip.error}</p>}
          {clip.url && !lengthOk && <p className="note note--error">The video must be {copy.min} to {copy.max} seconds long.</p>}
          {tool === "upscale" && clip.url && lengthOk && !size && <p className="note">This video is an older upload. Please upload it again so its size is known.</p>}
        </GpStep>

        {tool === "edit" ? (
          <GpStep n={2} title="What should change?" meta="one change" done={prompt.trim().length >= 3}>
            <div className="vt-ideas" role="group" aria-label="Examples">
              {EDIT_IDEAS.map((i) => (
                <button key={i.label} type="button" className="chip" onClick={() => setPrompt(i.text)}>{i.label}</button>
              ))}
            </div>
            <div className="gp-grow">
              <GpPrompt value={prompt} onChange={setPrompt} placeholder="e.g. Replace the background with a blue studio wall, keep everything else the same" onSubmit={generate} max={1000} rows={3} />
            </div>
          </GpStep>
        ) : (
          <>
            <GpStep n={2} title="Size" meta={outSize ?? "up to 4K"} done={Boolean(size)}>
              <div className="gp-seg">
                <Segmented
                  label="Enlargement"
                  value={factor}
                  onChange={(f) => fits(f) && setFactor(f)}
                  options={FACTORS.map((f) => ({ value: f, label: `${f}×` }))}
                />
              </div>
              {long !== null && !fits("3") && <p className="note">That is the limit: the result stays at 4K at most ({MAX_LONG} px).</p>}
            </GpStep>
            <GpStep n={3} title="Mode" meta={creativity === "precise" ? "stays faithful" : "adds detail"} done>
              <div className="gp-seg">
                <Segmented
                  label="Mode"
                  value={creativity}
                  onChange={setCreativity}
                  options={[{ value: "precise" as const, label: "Precise" }, { value: "creative" as const, label: "Creative" }]}
                />
              </div>
              <GpPrompt value={prompt} onChange={setPrompt} placeholder="Optional: what should stay sharp and true, e.g. the faces" max={300} rows={2} />
            </GpStep>
          </>
        )}

        <GpConsent checked={consent} onChange={setConsent}>
          I hold the rights to the video and the consent of everyone shown.
        </GpConsent>

        <GpFooter
          summary={tool === "edit" ? "Same length and motion, with your change" : outSize ? `${outSize}, same length and motion` : "Larger and sharper, up to 4K"}
          label={`Start ${copy.title}`}
          busy={busy}
          missing={busy ? null : missing}
          price={price}
          priceHint={clip.url ? "…" : "after upload"}
          disabled={!canGo}
          onGo={generate}
          title={priceText(price, 1, me?.credits ?? null)}
          notice={error ? <p className="note note--error" role="alert">{error}</p> : tooExpensive ? <NotEnough need={price ?? 0} have={me?.credits ?? 0} /> : null}
        />
      </aside>

      <section className="stage wall-page" aria-label="Results">
        <WallTitle words={["Video", "tools"]} />
        {results.length ? (
          <section className="wall-body" aria-label="My results">
            <Columns items={results} ratio={jobHeight} keyOf={jobKey} min={240} dense>
              {(j, i) => <JobCard job={j} onOpen={() => setOpen(i)} />}
            </Columns>
          </section>
        ) : (
          <div className="wall-empty">
            <p className="wall-empty__text">{copy.empty}</p>
          </div>
        )}
      </section>
      {open !== null && <Lightbox jobs={results} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
