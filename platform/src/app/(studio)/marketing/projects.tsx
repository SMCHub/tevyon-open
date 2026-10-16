"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownWideNarrow, Check, ChevronLeft, Folder, FolderPlus, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import type { Job } from "@/components/studio/studio-context";
import { searchProjects, sortProjects, type Project, type ProjectSort } from "./data";

export const SORT_LABEL: Record<ProjectSort, string> = { active: "Recently active", name: "Name A–Z", created: "Newest first" };
const SORTS: ProjectSort[] = ["active", "name", "created"];
export const nextSort = (s: ProjectSort): ProjectSort => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]!;

/** What the page knows about projects: the list and every change a view may make. */
export type ProjectsApi = {
  list: Project[];
  sort: ProjectSort;
  onSort: (s: ProjectSort) => void;
  open: (id: string) => void;
  create: () => void;
  rename: (id: string, name: string) => void;
  pin: (id: string) => void;
  remove: (id: string) => void;
  /** The project's newest finished output (image or video), for its cover. */
  cover: (p: Project) => { url: string; video: boolean } | null;
  /** When something last happened in it (newest generation, else its creation). */
  lastActive: (p: Project) => number;
};

/** Clicks outside or Escape close a menu. */
function useOutside(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(close);
  done.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && done.current();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && done.current();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return root;
}

export function ProjectCover({ cover, size }: { cover: { url: string; video: boolean } | null; size?: "sm" }) {
  if (!cover) return <span className={`ma-pcover ma-pcover--empty${size ? " ma-pcover--sm" : ""}`} aria-hidden="true"><Folder /></span>;
  return (
    <span className={`ma-pcover${size ? " ma-pcover--sm" : ""}`} aria-hidden="true">
      {cover.video
        ? <video src={cover.url} muted playsInline preload="metadata" />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={cover.url} alt="" loading="lazy" />}
    </span>
  );
}

/** A project's name as a field: Enter or leaving saves, Escape keeps the old name. */
export function NameField({ value, onSave, onDone, className }: { value: string; onSave: (name: string) => void; onDone: () => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const save = () => {
    const name = draft.trim().replace(/\s+/g, " ").slice(0, 60);
    if (name && name !== value) onSave(name);
    onDone();
  };
  return (
    <input
      ref={input}
      className={className ?? "ma-namefield"}
      value={draft}
      maxLength={60}
      aria-label="Project name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); save(); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDone(); }
      }}
    />
  );
}

/** Rename, pin, delete (asked once more). Deleting a project keeps its generations. */
export function ProjectMenu({ project, api, onRename, align = "end" }: { project: Project; api: ProjectsApi; onRename: () => void; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const root = useOutside(open, () => { setOpen(false); setConfirm(false); });
  return (
    <div className="ma-pmenu" ref={root}>
      <button type="button" className="ma-pmenu__btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Options for ${project.name}`}>
        <MoreHorizontal />
      </button>
      {open && (
        <div className={`ma-pmenu__list ma-pmenu__list--${align}`} role="menu">
          {confirm ? (
            <>
              <p className="ma-pmenu__ask">Delete “{project.name}”? The generations stay under “My generations”.</p>
              <button type="button" className="ma-pmenu__item is-danger" role="menuitem" onClick={() => { setOpen(false); setConfirm(false); api.remove(project.id); }}><Trash2 /> Delete project</button>
              <button type="button" className="ma-pmenu__item" role="menuitem" onClick={() => setConfirm(false)}><X /> Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="ma-pmenu__item" role="menuitem" onClick={() => { setOpen(false); onRename(); }}><Pencil /> Rename</button>
              <button type="button" className="ma-pmenu__item" role="menuitem" onClick={() => { setOpen(false); api.pin(project.id); }}>{project.pinned ? <><PinOff /> Unpin</> : <><Pin /> Pin</>}</button>
              <button type="button" className="ma-pmenu__item is-danger" role="menuitem" onClick={() => setConfirm(true)}><Trash2 /> Delete</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** “All projects”: every project as a card with its cover, searchable and sortable, plus a card to start a new one. */
export function ProjectsView({ api }: { api: ProjectsApi }) {
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = searchProjects(sortProjects(api.list, api.sort, api.lastActive), q);
  return (
    <section className="ms-explore ma-projects" aria-labelledby="ma-projects-title">
      <div className="ms-explore__head ms-explore__head--row">
        <div>
          <h2 className="ms-explore__title" id="ma-projects-title">Projects</h2>
          <p className="ms-fine">A project gathers generations like a folder. What you start in an open project lands in it.</p>
        </div>
        <div className="ma-results-tools">
          <label className="ms-search">
            <Search aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" />
          </label>
          <button type="button" className="ms-chip" onClick={() => api.onSort(nextSort(api.sort))} title="Change sorting" aria-label={`Sorting: ${SORT_LABEL[api.sort]}, change`}>
            <ArrowDownWideNarrow /> {SORT_LABEL[api.sort]}
          </button>
        </div>
      </div>
      <div className="ma-pgrid">
        {!q.trim() && (
          <button type="button" className="ma-pcard ma-pcard--new" onClick={api.create}>
            <span className="ma-pcard__media"><span className="ma-pcard__plus"><FolderPlus /></span></span>
            <span className="ma-pcard__name">New project</span>
          </button>
        )}
        {list.map((p) => (
          <div key={p.id} className="ma-pcard">
            <button type="button" className="ma-pcard__hit" onClick={() => api.open(p.id)} aria-label={`Open project ${p.name}, ${p.jobIds.length} generations`}>
              <span className="ma-pcard__media"><ProjectCover cover={api.cover(p)} /></span>
            </button>
            <span className="ma-pcard__row">
              {renaming === p.id
                ? <NameField value={p.name} onSave={(n) => api.rename(p.id, n)} onDone={() => setRenaming(null)} />
                : <span className="ma-pcard__name">{p.pinned && <Pin className="ma-pcard__pin" aria-label="Pinned" />}{p.name}</span>}
              <span className="ma-pcard__count">{p.jobIds.length}</span>
              <ProjectMenu project={p} api={api} onRename={() => setRenaming(p.id)} />
            </span>
          </div>
        ))}
      </div>
      {!list.length && q.trim() && <div className="empty empty--compact"><p>No project has that name.</p><button type="button" className="btn" onClick={() => setQ("")}>Clear search</button></div>}
    </section>
  );
}

/** The head of an open project: back to all projects, its name (click to rename), pin and the menu. */
export function ProjectHead({ project, api, onAll, count }: { project: Project; api: ProjectsApi; onAll: () => void; count: number }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <header className="ma-phead">
      <button type="button" className="ma-phead__back" onClick={onAll} aria-label="All projects"><ChevronLeft /></button>
      <ProjectCover cover={api.cover(project)} size="sm" />
      {renaming
        ? <NameField value={project.name} onSave={(n) => api.rename(project.id, n)} onDone={() => setRenaming(false)} className="ma-namefield ma-namefield--big" />
        : <button type="button" className="ma-phead__name" onClick={() => setRenaming(true)} title="Rename">{project.name}<Pencil aria-hidden="true" /></button>}
      <span className="ma-phead__meta">{count} {count === 1 ? "generation" : "generations"}{project.pinned ? " · pinned" : ""}</span>
      <span className="ma-phead__tools">
        <ProjectMenu project={project} api={api} onRename={() => setRenaming(true)} />
      </span>
    </header>
  );
}

/** “To project” on a result: pick a project (or a new one); a tick shows where the result already is. */
export function ToProject({ jobId, api, onAdd }: { jobId: string; api: ProjectsApi; onAdd: (projectId: string | "new") => void }) {
  const [open, setOpen] = useState(false);
  const root = useOutside(open, () => setOpen(false));
  const list = sortProjects(api.list, api.sort, api.lastActive).slice(0, 8);
  const inside = api.list.filter((p) => p.jobIds.includes(jobId));
  return (
    <div className="ma-pmenu" ref={root}>
      <button type="button" className="ms-mini" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={inside.length ? `In ${inside.map((p) => p.name).join(", ")}` : "Add to a project"}>
        <FolderPlus /> {inside.length ? (inside.length === 1 ? inside[0]!.name.slice(0, 18) : `${inside.length} projects`) : "To project"}
      </button>
      {open && (
        <div className="ma-pmenu__list ma-pmenu__list--start" role="menu">
          {list.map((p) => {
            const has = p.jobIds.includes(jobId);
            return (
              <button key={p.id} type="button" className="ma-pmenu__item" role="menuitem" disabled={has} onClick={() => { setOpen(false); onAdd(p.id); }}>
                {has ? <Check /> : <Folder />}<span className="ma-pmenu__label">{p.name}</span>
              </button>
            );
          })}
          <button type="button" className="ma-pmenu__item" role="menuitem" onClick={() => { setOpen(false); onAdd("new"); }}><Plus /> New project</button>
        </div>
      )}
    </div>
  );
}

/** A finished output of a job for covers: image or video, never a failed or running one. */
export function outputOf(job: Job | undefined): { url: string; video: boolean } | null {
  const out = job?.status === "succeeded" ? job.outputs[0] : undefined;
  return out ? { url: out.url, video: out.contentType.startsWith("video/") } : null;
}
