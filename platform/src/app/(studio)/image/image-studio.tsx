"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "@/components/studio/composer";
import { JobCard, Lightbox } from "@/components/studio/job-views";
import { ratio } from "@/components/studio/schema";
import { useStudio, type Job } from "@/components/studio/studio-context";
import { Columns, WallTitle } from "@/components/studio/wall";

// Heights in column widths before the image loads, from the job's format.
const jobHeight = (j: Job) => 1 / ratio(j.params.aspect_ratio ?? "1:1");
const jobKey = (j: Job) => j.id;

/**
 * The image studio: the name runs sideways along the wall, your own images newest first, the composer at the bottom,
 * as on every page with a prompt bar.
 */
export function ImageStudio() {
  const { jobs, kindOf } = useStudio();
  const [open, setOpen] = useState<number | null>(null);
  // Yours, newest first; failed ones stay in Assets, not on the wall.
  const images = useMemo(
    () => jobs.filter((j) => kindOf(j.jobType) === "image" && j.status !== "failed").sort((a, b) => b.createdAt - a.createdAt),
    [jobs, kindOf],
  );
  // A new image of yours (you just pressed GENERATE) shows on top: scroll up to it.
  const running = images.filter((j) => j.status === "queued" || j.status === "running").length;
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (seen.current !== null && running > seen.current) window.scrollTo({ top: 0, behavior: "smooth" });
    seen.current = running;
  }, [running]);

  return (
    <div className="studio studio--image wall-page">
      <WallTitle words={["My", "Images"]} />

      {images.length ? (
        <section className="wall-body" aria-label="My images">
          <Columns items={images} ratio={jobHeight} keyOf={jobKey} min={240} dense>
            {(j, i) => <JobCard job={j} onOpen={() => setOpen(i)} />}
          </Columns>
        </section>
      ) : (
        <div className="wall-empty">
          <p className="wall-empty__text">No images yet. Describe below what you want to create.</p>
        </div>
      )}

      <Composer />
      {open !== null && <Lightbox jobs={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
