"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FolderOpen, Search } from "lucide-react";
import { JobCard, Lightbox, jobText } from "@/components/studio/job-views";
import { useStudio, type Job } from "@/components/studio/studio-context";

type Filter = "all" | "image" | "video" | "failed";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Videos" },
  { id: "failed", label: "Failed" },
];

const DAY = 86_400_000;
function groupOf(ms: number): string {
  const today = new Date().setHours(0, 0, 0, 0);
  if (ms >= today) return "Today";
  if (ms >= today - DAY) return "Yesterday";
  if (ms >= today - 6 * DAY) return "This week";
  return new Date(ms).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function Assets() {
  const { jobs, kindOf, loaded } = useStudio();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const counts = useMemo(() => ({
    all: jobs.filter((j) => j.status !== "failed").length,
    image: jobs.filter((j) => j.status !== "failed" && kindOf(j.jobType) === "image").length,
    video: jobs.filter((j) => j.status !== "failed" && kindOf(j.jobType) === "video").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  }), [jobs, kindOf]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      const ok = filter === "failed" ? j.status === "failed" : j.status !== "failed" && (filter === "all" || kindOf(j.jobType) === filter);
      return ok && (!q || jobText(j).toLowerCase().includes(q) || j.model.toLowerCase().includes(q));
    });
  }, [jobs, filter, query, kindOf]);

  // Date groups keep the global index, so the lightbox pages through everything shown.
  const groups = useMemo(() => {
    const out: { label: string; items: { job: Job; index: number }[] }[] = [];
    shown.forEach((job, index) => {
      const label = groupOf(job.createdAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push({ job, index });
      else out.push({ label, items: [{ job, index }] });
    });
    return out;
  }, [shown]);

  return (
    <div className="studio studio--assets">
      <header className="page-head">
        <div>
          <h1 className="page-title">Assets</h1>
          <p className="page-sub">{counts.image} {counts.image === 1 ? "image" : "images"} · {counts.video} {counts.video === 1 ? "video" : "videos"}. Everything you made, stored safely with Tevyon.</p>
        </div>
      </header>

      <div className="assets-bar">
        <div className="filters" role="tablist" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="filters__item" onClick={() => setFilter(f.id)}>
              {f.label} <span className="count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="assets-bar__right">
          <label className="search-box">
            <Search aria-hidden="true" />
            <input type="search" placeholder="Search prompt or model" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search Assets" />
          </label>
        </div>
      </div>

      {shown.length ? (
        groups.map((g) => (
          <section key={g.label} className="assets-group" aria-label={g.label}>
            <h2 className="assets-group__title">{g.label} <span>{g.items.length}</span></h2>
            <div className="masonry masonry--assets">
              {g.items.map(({ job, index }) => <JobCard key={job.id} job={job} onOpen={() => setOpen(index)} />)}
            </div>
          </section>
        ))
      ) : loaded ? (
        <div className="empty">
          <FolderOpen aria-hidden="true" />
          <p>{query ? "Nothing found." : "Your images and videos land here."}</p>
          {!query && <p className="empty__links"><Link href="/image">Create an image</Link> · <Link href="/video">Create a video</Link></p>}
        </div>
      ) : null}

      {open !== null && <Lightbox jobs={shown} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
