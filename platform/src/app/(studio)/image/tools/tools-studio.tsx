"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ImageUpscale, Maximize2, Scissors, SunMedium } from "lucide-react";
import { NotEnough, priceText, startErrorText } from "@/components/studio/credits";
import { GpFooter, GpModel, GpModes, GpPrompt, GpStep } from "@/components/studio/gen-panel";
import { JobCard, Lightbox } from "@/components/studio/job-views";
import { OptionPills } from "@/components/studio/options";
import type { JsonSchema } from "@/components/studio/schema";
import { Segmented } from "@/components/studio/segmented";
import { useStudio, type Job } from "@/components/studio/studio-context";
import { DropZone, useUpload } from "@/components/studio/upload";
import { Columns, WallTitle } from "@/components/studio/wall";

type Tool = "cutout" | "upscale" | "relight" | "background";
type Scale = "2x" | "4x";

const TOOLS: Record<Tool, { jobType: string; title: string; cover: string; hint: string; empty: string }> = {
  cutout: {
    jobType: "cutout",
    title: "Cutout",
    cover: "/marketing/tpl-studio-white.webp",
    hint: "Best with a clear subject: person, product, animal",
    empty: "Upload an image on the left. You get it back without its background, as a PNG with transparency.",
  },
  upscale: {
    jobType: "upscale",
    title: "Upscale",
    cover: "/marketing/tpl-glacier-lake.webp",
    hint: "Photos, graphics and your own results",
    empty: "Upload an image on the left. You get it back sharper and larger; the content stays as it is.",
  },
  relight: {
    jobType: "relight",
    title: "Relight",
    cover: "/marketing/tpl-breakfast-light.webp",
    hint: "Photos with a clear scene: people, products, rooms",
    empty: "Upload an image on the left and pick a light. You get the same picture back in the new light.",
  },
  background: {
    jobType: "replace_background",
    title: "Replace Background",
    cover: "/marketing/tpl-dune-shadow.webp",
    hint: "Best with a clear subject: person, product, animal",
    empty: "Upload an image on the left and describe the new setting. The subject stays, the background changes.",
  },
};

const toolOf = (v: string | null): Tool => (v === "upscale" || v === "relight" || v === "background" ? v : "cutout");
const TOOL_TYPES = new Set(Object.values(TOOLS).map((t) => t.jobType));
const jobHeight = () => 1;
const jobKey = (j: Job) => j.id;

/**
 * Cutout, Upscale, Relight and Replace Background (mega menu "Image"): image tools from the register. One picture in,
 * one out; the price shows before the start. ?tool=upscale|relight|background picks the tool, ?image=<own upload> brings a picture along (e.g. from a result).
 * The page offers only the tools the register has.
 */
export function ToolsStudio() {
  const router = useRouter();
  const search = useSearchParams();
  const { catalog, me, jobs, start, quote } = useStudio();
  const tool = toolOf(search.get("tool"));
  const copy = TOOLS[tool];
  const entry = catalog.find((c) => c.jobType === copy.jobType);
  // Relight's light and direction come from the register's schema, so its choices never drift from the model.
  const lightSchema: JsonSchema | null = tool === "relight" && entry?.params.properties
    ? { type: "object", properties: { light: entry.params.properties.light!, direction: entry.params.properties.direction! } }
    : null;

  const up = useUpload();
  const [scale, setScale] = useState<Scale>("2x");
  const [light, setLight] = useState<Record<string, unknown>>({});
  const [scene, setScene] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  // A picture handed over (?image=) or "Reuse" of a tool job (?from=): the same picture again.
  const handed = search.get("image");
  const from = search.get("from");
  useEffect(() => {
    if (handed) up.setUrl(handed);
    const j = from ? jobs.find((x) => x.id === from) : undefined;
    if (j && typeof j.params.image === "string") up.setUrl(j.params.image);
    if (j && (j.params.scale === "2x" || j.params.scale === "4x")) setScale(j.params.scale);
    if (j && typeof j.params.light === "string") setLight({ light: j.params.light, direction: j.params.direction });
    if (j && j.jobType === "replace_background" && typeof j.params.prompt === "string") setScene(j.params.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handed, from, jobs.length > 0]);

  const params = useMemo(() => {
    if (!up.url) return null;
    if (tool === "upscale") return { image: up.url, scale };
    if (tool === "relight") return { image: up.url, ...light };
    if (tool === "background") return scene.trim().length >= 3 ? { image: up.url, prompt: scene.trim() } : null;
    return { image: up.url };
  }, [up.url, tool, scale, light, scene]);

  // The background's price does not depend on its words: quote again only when the picture or settings change.
  const priceKey = params ? JSON.stringify({ ...params, prompt: "" }) : null;

  useEffect(() => {
    let live = true;
    setPrice(null);
    if (params) quote(copy.jobType, params).then((p) => live && setPrice(p));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey, quote, copy.jobType]);

  const results = jobs.filter((j) => TOOL_TYPES.has(j.jobType));
  const tooExpensive = me !== null && price !== null && price > me.credits;
  const missing = !entry ? "Tool not available"
    : !up.url ? "Image missing"
    : up.busy ? "Uploading…"
    : tool === "background" && scene.trim().length < 3 ? "Setting missing"
    : tooExpensive ? "Not enough Credits"
    : null;
  const canGo = Boolean(entry && params && !missing && !busy && price !== null);

  async function generate() {
    if (!canGo || !params) return;
    setBusy(true);
    setError(null);
    // Cutout, upscale and relight take no prompt; an empty one never reaches the prompt writer (prompting.ts).
    const res = await start(copy.jobType, params, 1, price !== null ? { maxCredits: price } : {});
    setBusy(false);
    if (!res.ok) setError(startErrorText(res));
  }

  function choose(next: Tool) {
    if (next === tool) return;
    setError(null);
    const keep = up.url ? `&image=${encodeURIComponent(up.url)}` : "";
    router.replace(`/image/tools?tool=${next}${keep}`, { scroll: false });
  }

  return (
    <div className="studio studio--video">
      <aside className="panel gp gp--compact" aria-label={copy.title}>
        <GpModes
          label="Tool"
          value={tool}
          onChange={choose}
          modes={([
            { id: "cutout" as const, label: "Cutout", icon: <Scissors aria-hidden="true" /> },
            { id: "upscale" as const, label: "Upscale", icon: <Maximize2 aria-hidden="true" /> },
            { id: "relight" as const, label: "Relight", icon: <SunMedium aria-hidden="true" /> },
            { id: "background" as const, label: "Background", icon: <ImageUpscale aria-hidden="true" /> },
          ]).filter((m) => m.id === tool || catalog.some((c) => c.jobType === TOOLS[m.id].jobType))}
        />
        <GpModel cover={copy.cover} name={entry?.model ?? copy.title} tagline={entry?.tagline} kicker="Tool" />

        <GpStep n={1} title="Image" meta="JPG, PNG, WebP" done={Boolean(up.url)}>
          <DropZone up={up} title="Add image" hint={copy.hint} />
          {up.error && <p className="note note--error" role="alert">{up.error}</p>}
        </GpStep>
        {tool === "upscale" && (
          <GpStep n={2} title="Enlargement" meta="2× or 4×" done>
            <Segmented label="Enlargement" value={scale} onChange={setScale} options={[{ value: "2x", label: "2×" }, { value: "4x", label: "4×" }]} />
          </GpStep>
        )}
        {tool === "relight" && lightSchema && (
          <GpStep n={2} title="Light" meta="type and direction" done>
            <div className="gp-opts">
              <OptionPills schema={lightSchema} opts={light} setOpt={(k, v) => setLight((x) => ({ ...x, [k]: v }))} />
            </div>
          </GpStep>
        )}
        {tool === "background" && (
          <GpStep n={2} title="New setting" meta="the subject stays" done={scene.trim().length >= 3}>
            <GpPrompt value={scene} onChange={setScene} placeholder="e.g. A sunlit marble kitchen counter" onSubmit={generate} max={500} rows={3} />
          </GpStep>
        )}

        <GpFooter
          summary={tool === "cutout" ? "PNG with transparency, original size"
            : tool === "upscale" ? `${scale === "4x" ? "4×" : "2×"} larger, sharper`
            : tool === "relight" ? "Same picture, new light"
            : "Same subject, new setting"}
          label={`Start ${copy.title}`}
          busy={busy}
          missing={busy ? null : missing}
          price={price}
          priceHint={params ? "…" : "after upload"}
          disabled={!canGo}
          onGo={generate}
          title={priceText(price, 1, me?.credits ?? null)}
          notice={error ? <p className="note note--error" role="alert">{error}</p> : tooExpensive ? <NotEnough need={price ?? 0} have={me?.credits ?? 0} /> : null}
        />
      </aside>

      <section className="stage wall-page" aria-label="Results">
        <WallTitle words={["My", "tools"]} />
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
