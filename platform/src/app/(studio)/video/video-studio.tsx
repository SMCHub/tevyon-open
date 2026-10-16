"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Image as ImageIcon, Type } from "lucide-react";
import { NotEnough, priceText, startErrorText } from "@/components/studio/credits";
import { ModelPicker, useDraft } from "@/components/studio/draft";
import { JobCard, Lightbox } from "@/components/studio/job-views";
import { OptionPills } from "@/components/studio/options";
import { ratio } from "@/components/studio/schema";
import { useStudio, type Job } from "@/components/studio/studio-context";
import { Columns, WallTitle } from "@/components/studio/wall";
import { GpConsent, GpFooter, GpModes, GpOptions, GpPrompt, GpStep } from "@/components/studio/gen-panel";
import { DropZone, useUpload } from "@/components/studio/upload";

type Mode = "text" | "image";
const modeOf = (v: string | null): Mode => (v === "image" ? "image" : "text");

// Heights in column widths before the media loads, from the job's format.
const jobHeight = (j: Job) => 1 / ratio(j.params.aspect_ratio ?? "16:9");
const jobKey = (j: Job) => j.id;

/** Models that take a start image (an `image` parameter); the image mode offers only these. */
const takesImage = (m: { params: { properties?: Record<string, unknown> } }) => Boolean(m.params.properties?.image);

export function VideoStudio() {
  const { me, jobs, kindOf, start } = useStudio();
  const d = useDraft("video");
  // ?mode=image (header menu "Bild → Video") opens with the start frame upload.
  const search = useSearchParams();
  const [mode, setMode] = useState<Mode>(modeOf(search.get("mode")));
  const wanted = modeOf(search.get("mode"));
  useEffect(() => {
    if (wanted !== "text") setMode(wanted);
  }, [wanted]);
  const up = useUpload();
  const pickable = mode === "image" ? d.models.filter(takesImage) : d.models;
  // The image mode runs only models with a start image: switch to the first one when the chosen one has none.
  useEffect(() => {
    if (mode === "image" && d.model && !takesImage(d.model) && pickable[0]) d.chooseModel(pickable[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, d.model?.jobType]);
  const [consent, setConsent] = useState(false);
  // "Erneut verwenden" of an image-to-video job brings its start frame along.
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
  const canGo = Boolean(d.model && d.prompt.trim() && !busy && !tooExpensive && (!needsImage || (up.url && consent)));

  // Why the button still waits, in its own words (instead of a silent grey button).
  const missing = !d.model ? "Modell lädt …"
    : mode === "image" && !up.url ? "Startbild fehlt"
    : !d.prompt.trim() ? "Text fehlt"
    : mode === "image" && !consent ? "Einwilligung fehlt"
    : tooExpensive ? "Zu wenig Credits"
    : null;

  const promptHint = mode === "image"
    ? "Was soll passieren? z. B. Die Person lacht und dreht sich zur Kamera, Konfetti fällt"
    : "Langsame Kamerafahrt über einen Bergsee im Morgennebel, ein Ruderboot zieht eine feine Spur …";

  async function generate() {
    if (!canGo || !d.model) return;
    setBusy(true);
    setError(null);
    const { image: _drop, ...rest } = d.params as Record<string, unknown>;
    const params = needsImage && up.url ? { ...rest, image: up.url } : rest;
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
      <aside className="panel gp gp--compact" aria-label="Video erstellen">
        <GpModes
          label="Modus"
          value={mode}
          onChange={setMode}
          modes={[
            { id: "text" as const, label: "Text", icon: <Type aria-hidden="true" /> },
            { id: "image" as const, label: "Bild", icon: <ImageIcon aria-hidden="true" /> },
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
            <GpStep n={1} title="Startbild" meta="JPG, PNG, WebP" done={Boolean(up.url)}>
              <DropZone up={up} title="Startbild hierher ziehen oder klicken" hint="Das Video beginnt mit genau diesem Bild" />
              {up.error && <p className="note note--error">{up.error}</p>}
            </GpStep>
            <GpStep n={2} title="Was passiert?" meta="Bewegung, Kamera" done={Boolean(d.prompt.trim())}>
              <GpPrompt value={d.prompt} onChange={d.setPrompt} placeholder={promptHint} onSubmit={generate} />
            </GpStep>
            {settings}
            <GpConsent checked={consent} onChange={setConsent}>Ich habe die Rechte am Bild und die Einwilligung aller abgebildeten Personen.</GpConsent>
          </>
        )}

        <GpFooter
          label="Video generieren"
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
        <WallTitle words={["Meine", "Videos"]} />
        {videos.length ? (
          <section className="wall-body" aria-label="Meine Videos">
            <Columns items={videos} ratio={jobHeight} keyOf={jobKey} min={240} dense>
              {(j, i) => <JobCard job={j} onOpen={() => setOpen(i)} />}
            </Columns>
          </section>
        ) : (
          <div className="wall-empty">
            <p className="wall-empty__text">Noch keine Videos. Schreib links einen Satz oder nimm ein Startbild.</p>
          </div>
        )}
      </section>
      {open !== null && <Lightbox jobs={videos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
