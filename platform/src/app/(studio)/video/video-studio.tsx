"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clapperboard, Image as ImageIcon, Type } from "lucide-react";
import { NotEnough, priceText, startErrorText } from "@/components/studio/credits";
import { ModelPicker, useDraft } from "@/components/studio/draft";
import { JobCard, Lightbox } from "@/components/studio/job-views";
import { OptionPills } from "@/components/studio/options";
import { ratio } from "@/components/studio/schema";
import { useStudio, type Job } from "@/components/studio/studio-context";
import { Columns, WallTitle } from "@/components/studio/wall";
import { GpConsent, GpFooter, GpModes, GpOptions, GpPrompt, GpStep } from "@/components/studio/gen-panel";
import { DropZone, useUpload } from "@/components/studio/upload";

type Mode = "text" | "image" | "recast";
const modeOf = (v: string | null): Mode => (v === "image" || v === "recast" ? v : "text");

// Heights in column widths before the media loads, from the job's format.
const jobHeight = (j: Job) => 1 / ratio(j.params.aspect_ratio ?? "16:9");
const jobKey = (j: Job) => j.id;

type ModelLike = { params: { properties?: Record<string, unknown> } };
/** Models that take a reference video (a `video` parameter): Recast. Only the recast mode offers them. */
const takesVideo = (m: ModelLike) => Boolean(m.params.properties?.video);
/** Models that take a start image (an `image` parameter); the image mode offers only these. */
const takesImage = (m: ModelLike) => Boolean(m.params.properties?.image) && !takesVideo(m);
const fits = (mode: Mode) => (m: ModelLike) => (mode === "recast" ? takesVideo(m) : mode === "image" ? takesImage(m) : !takesVideo(m));

export function VideoStudio() {
  const { me, jobs, kindOf, start } = useStudio();
  const d = useDraft("video");
  // ?mode=image (header menu "Image → Video") opens with the start frame upload.
  const search = useSearchParams();
  const [mode, setMode] = useState<Mode>(modeOf(search.get("mode")));
  const wanted = modeOf(search.get("mode"));
  useEffect(() => {
    if (wanted !== "text") setMode(wanted);
  }, [wanted]);
  const up = useUpload();
  const ref = useUpload("video");
  const pickable = d.models.filter(fits(mode));
  // Each mode runs only the models that fit it: switch to the first one when the chosen one does not.
  useEffect(() => {
    if (d.model && !fits(mode)(d.model) && pickable[0]) d.chooseModel(pickable[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, d.model?.jobType]);
  // Recast prices by the length of the reference video: it joins the draft's settings, so the quote sees it.
  useEffect(() => {
    if (mode === "recast") d.setOpt("video", ref.url ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ref.url]);
  const [consent, setConsent] = useState(false);
  // "Reuse" of an image-to-video job brings its start frame along.
  useEffect(() => {
    const img = d.opts.image;
    if (typeof img === "string" && !up.url) {
      setMode("image");
      up.setUrl(img);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.opts.image]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const videos = jobs.filter((j) => kindOf(j.jobType) === "video");

  const tooExpensive = me !== null && d.total !== null && d.total > me.credits;
  const needsImage = mode === "image";
  const needsVideo = mode === "recast";
  const canGo = Boolean(d.model && d.prompt.trim() && !busy && !tooExpensive && (!needsImage || (up.url && consent)) && (!needsVideo || (ref.url && consent)));

  // Why the button still waits, in its own words (instead of a silent grey button).
  const missing = !d.model ? "Loading model…"
    : mode === "image" && !up.url ? "Start image missing"
    : mode === "recast" && !ref.url ? "Reference video missing"
    : !d.prompt.trim() ? "Prompt missing"
    : mode !== "text" && !consent ? "Consent missing"
    : tooExpensive ? "Not enough Credits"
    : null;

  const promptHint = mode === "image"
    ? "What should happen? e.g. The person laughs and turns to the camera, confetti falls"
    : mode === "recast"
      ? "What does the new clip show? e.g. The same flight, over a snowy mountain valley at night"
      : "Slow camera move over a mountain lake in the morning mist, a rowing boat leaves a fine trail…";

  async function generate() {
    if (!canGo || !d.model) return;
    setBusy(true);
    setError(null);
    const { image: _drop, video: _video, ...rest } = d.params as Record<string, unknown>;
    const params = needsImage && up.url ? { ...rest, image: up.url } : needsVideo && ref.url ? { ...rest, video: ref.url } : rest;
    // The price on the button is the price the user agreed to; a higher server price starts nothing.
    const res = await start(d.model.jobType, params, 1, d.price !== null ? { maxCredits: d.price } : {});
    setBusy(false);
    if (!res.ok) {
      if (res.error === "price_changed") d.requote();
      return setError(startErrorText(res));
    }
  }

  // Format, resolution, length and sound as pills right under the text.
  const settings = d.model ? (
    <GpOptions>
      <OptionPills schema={d.model.params} opts={d.opts} setOpt={d.setOpt} side="auto" />
    </GpOptions>
  ) : null;

  return (
    <div className="studio studio--video">
      <aside className="panel gp gp--compact" aria-label="Create video">
        <GpModes
          label="Mode"
          value={mode}
          onChange={setMode}
          modes={[
            { id: "text" as const, label: "Text", icon: <Type aria-hidden="true" /> },
            { id: "image" as const, label: "Image", icon: <ImageIcon aria-hidden="true" /> },
            { id: "recast" as const, label: "Recast", icon: <Clapperboard aria-hidden="true" /> },
          ]}
        />

        {/* The whole model row opens the list, grouped by family with resolution, length, sound and price. */}
        <ModelPicker models={pickable} model={d.model} onChoose={d.chooseModel} side="auto" variant="row" />

        {mode === "text" && (
          <>
            {/* The text needs no heading: its field fills the panel and the placeholder says what goes in. */}
            <div className="gp-grow">
              <GpPrompt value={d.prompt} onChange={d.setPrompt} placeholder={promptHint} onSubmit={generate} />
            </div>
            {settings}
          </>
        )}

        {mode === "image" && (
          <>
            <GpStep n={1} title="Start image" meta="JPG, PNG, WebP" done={Boolean(up.url)}>
              <DropZone up={up} title="Drop a start image or click" hint="The video starts with exactly this image" />
              {up.error && <p className="note note--error">{up.error}</p>}
            </GpStep>
            <GpStep n={2} title="What happens?" meta="Motion, camera" done={Boolean(d.prompt.trim())}>
              <GpPrompt value={d.prompt} onChange={d.setPrompt} placeholder={promptHint} onSubmit={generate} />
            </GpStep>
            {settings}
            <GpConsent checked={consent} onChange={setConsent}>I own the rights to this image and have the consent of everyone shown in it.</GpConsent>
          </>
        )}

        {mode === "recast" && (
          <>
            <GpStep n={1} title="Reference video" meta="MP4, MOV · 2–15 s" done={Boolean(ref.url)}>
              <DropZone up={ref} title="Drop a clip or click" hint="Its motion and camera stay; the scene changes" />
              {ref.error && <p className="note note--error">{ref.error}</p>}
            </GpStep>
            <GpStep n={2} title="New scene" meta="Subject, setting, look" done={Boolean(d.prompt.trim())}>
              <GpPrompt value={d.prompt} onChange={d.setPrompt} placeholder={promptHint} onSubmit={generate} />
            </GpStep>
            {settings}
            <GpConsent checked={consent} onChange={setConsent}>I own the rights to this clip and have the consent of everyone shown in it.</GpConsent>
          </>
        )}

        <GpFooter
          label="Generate video"
          busy={busy}
          missing={busy ? null : missing}
          price={d.total}
          priceHint="…"
          disabled={!canGo}
          onGo={generate}
          title={priceText(d.price, 1, me?.credits ?? null)}
          notice={error ? <p className="note note--error" role="alert">{error}</p> : tooExpensive ? <NotEnough need={d.total ?? 0} have={me?.credits ?? 0} /> : null}
        />
      </aside>

      <section className="stage wall-page" aria-label="Videos">
        <WallTitle words={["My", "Videos"]} />
        {videos.length ? (
          <section className="wall-body" aria-label="My videos">
            <Columns items={videos} ratio={jobHeight} keyOf={jobKey} min={240} dense>
              {(j, i) => <JobCard job={j} onOpen={() => setOpen(i)} />}
            </Columns>
          </section>
        ) : (
          <div className="wall-empty">
            <p className="wall-empty__text">No videos yet. Write a sentence on the left or use a start image.</p>
          </div>
        )}
      </section>
      {open !== null && <Lightbox jobs={videos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
