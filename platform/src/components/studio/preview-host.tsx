"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lightbox } from "./job-views";
import { EntryAside, MediaPreview, PreviewContext, PreviewStage, type Preview } from "./media-preview";
import type { PreviewEntry } from "./preview";
import { useStudio, type Job } from "./studio-context";

type Open = { index: number } & ({ jobs: string[] } | { entries: PreviewEntry[] });

/**
 * One media preview for the whole studio: any tile opens it through `usePreview()` with a list of entries or of own
 * jobs (looked up live, so a running job turns into its result while it is open). A page change closes it.
 */
export function PreviewProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Open | null>(null);
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setOpen(null);
  }
  const value = useMemo<Preview>(() => ({
    openJobs: (jobs, index = 0) => setOpen({ jobs, index }),
    openEntries: (entries, index = 0) => setOpen({ entries, index }),
  }), []);
  const close = useCallback(() => setOpen(null), []);
  const page = useCallback((index: number) => setOpen((o) => (o ? { ...o, index } : o)), []);

  return (
    <PreviewContext.Provider value={value}>
      {children}
      {open && ("jobs" in open
        ? <JobsPreview ids={open.jobs} index={open.index} onIndex={page} onClose={close} />
        : <EntriesPreview entries={open.entries} index={open.index} onIndex={page} onClose={close} />)}
    </PreviewContext.Provider>
  );
}

function JobsPreview({ ids, index, onIndex, onClose }: { ids: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const { jobs } = useStudio();
  const list = ids.map((id) => jobs.find((j) => j.id === id)).filter((j): j is Job => Boolean(j));
  return <Lightbox jobs={list} index={Math.min(index, list.length - 1)} onIndex={onIndex} onClose={onClose} />;
}

function EntriesPreview({ entries, index, onIndex, onClose }: { entries: PreviewEntry[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const router = useRouter();
  const entry = entries[index];
  if (!entry) return null;
  const act = () => {
    const a = entry.action;
    if (!a || a.disabled) return;
    onClose();
    if (a.run) a.run();
    else if (a.href) router.push(a.href);
  };
  return (
    <MediaPreview
      label={entry.title}
      count={entries.length}
      index={index}
      onIndex={onIndex}
      onClose={onClose}
      stage={<PreviewStage media={entry} alt={entry.title} />}
      aside={<EntryAside entry={entry} onClose={onClose} onAction={act} />}
    />
  );
}
