"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Flag, Heart, UserRound } from "lucide-react";
import type { Creation, FeedSort, Kind, PublicProfile } from "@/core/community";
import { ReportDialog, Toast, loginHere, setLike } from "./community";
import { creationEntry, creationHeight } from "./community-view";
import { LoopVideo } from "./loop-video";
import { usePreview } from "./media-preview";
import { Columns, Shot } from "./wall";

export type Filter = "all" | Kind;
export const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "image", label: "Bilder" },
  { id: "video", label: "Videos" },
];
/** «Neu», «Beliebt» and, signed in, «Gefolgt» (only creators the account follows). */
export type Order = FeedSort | "following";
export const ORDERS: { id: Order; label: string }[] = [
  { id: "new", label: "Neu" },
  { id: "popular", label: "Beliebt" },
  { id: "following", label: "Gefolgt" },
];
/** A creator's page also carries the public profile, counts and whether the viewer follows (whatever the filter). */
export type CreatorHead = { profile: PublicProfile; counts: Record<Kind, number>; followers: number; following: number; followed?: boolean };
type Page = { items: Creation[]; next: string | null } & Partial<CreatorHead>;

/**
 * A page of public creations from `source` (/api/community or /api/community/<handle>) for one kind and order, and the
 * next pages on demand. A new source, kind or order starts over; an answer for an older one is dropped. `initial`:
 * the first page as the server rendered it (newest first, all kinds), so the page shows at once.
 */
export function useFeed(source: string, filter: Filter, order: Order = "new", initial?: Page | null) {
  const [items, setItems] = useState<Creation[]>(initial?.items ?? []);
  const [next, setNext] = useState<string | null>(initial?.next ?? null);
  const [head, setHead] = useState<CreatorHead | null>(initial?.profile ? (initial as CreatorHead) : null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed" | "missing">(initial ? "ready" : "loading");
  const [busy, setBusy] = useState(false);
  const current = useRef("");
  const seeded = useRef(Boolean(initial));

  const fetchPage = useCallback(async (before: string | null) => {
    const q = new URLSearchParams({
      ...(filter === "all" ? {} : { kind: filter }),
      ...(order === "popular" ? { sort: "popular" } : {}),
      ...(order === "following" ? { following: "1" } : {}),
      ...(before ? { before } : {}),
    });
    const r = await fetch(`${source}${q.size ? `?${q}` : ""}`, { cache: "no-store" });
    if (r.status === 404) return "missing" as const;
    const d = (await r.json().catch(() => null)) as (Page & { ok?: boolean }) | null;
    return r.ok && d?.ok ? d : null;
  }, [source, filter, order]);

  useEffect(() => {
    const key = `${source}|${filter}|${order}`;
    current.current = key;
    // The server's first page stands for the default view; any other view loads.
    if (seeded.current && filter === "all" && order === "new") {
      seeded.current = false;
      return;
    }
    seeded.current = false;
    setStatus("loading");
    fetchPage(null)
      .then((d) => {
        if (current.current !== key) return;
        if (d === "missing") return setStatus("missing");
        if (!d) return setStatus("failed");
        setItems(d.items);
        setNext(d.next);
        if (d.profile) setHead({ profile: d.profile, counts: d.counts!, followers: d.followers ?? 0, following: d.following ?? 0, ...(d.followed === undefined ? {} : { followed: d.followed }) });
        setStatus("ready");
      })
      .catch(() => current.current === key && setStatus("failed"));
  }, [source, filter, order, fetchPage]);

  const more = useCallback(async () => {
    if (!next || busy) return;
    const key = current.current;
    setBusy(true);
    try {
      const d = await fetchPage(next);
      if (current.current !== key || !d || d === "missing") return;
      // A creation published meanwhile can shift a page; never list one twice.
      setItems((have) => [...have, ...d.items.filter((c) => !have.some((h) => h.id === c.id))]);
      setNext(d.next);
    } finally {
      setBusy(false);
    }
  }, [next, busy, fetchPage]);

  /** Changes one creation in place (a like from the preview). */
  const patch = useCallback((id: string, change: Partial<Creation>) => setItems((have) => have.map((c) => (c.id === id ? { ...c, ...change } : c))), []);
  /** Changes the creator's head (a follow). */
  const patchHead = useCallback((change: Partial<CreatorHead>) => setHead((h) => (h ? { ...h, ...change } : h)), []);

  return { items, next, head, status, busy, more, patch, patchHead };
}

/** What the tile shows on hover: the creator, likes, format and length. */
function factsOf(c: Creation, showCreator: boolean): string[] {
  return [
    showCreator ? `@${c.creator.handle}` : null,
    c.likes > 0 ? `♥ ${c.likes}` : null,
    c.aspect ? `Format ${c.aspect}` : null,
    c.kind === "video" && c.duration ? `${c.duration} s` : null,
  ].filter((f): f is string => Boolean(f));
}

/**
 * Beside «Prompt übernehmen» in the preview of a public creation: like (with the count), the creator's page and
 * «Melden». Your own creation shows only its count; without a login like and «Melden» lead to the login first.
 */
function CreationActions({ c, own, guest, showCreator, onLiked, onNote }: {
  c: Creation; own: boolean; guest: boolean; showCreator: boolean;
  onLiked: (id: string, liked: boolean, likes: number) => void;
  onNote: (t: string) => void;
}) {
  const [liked, setLiked] = useState(Boolean(c.liked));
  const [likes, setLikes] = useState(c.likes);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);

  async function toggle() {
    if (guest) return void (window.location.href = loginHere());
    if (busy) return;
    const next = !liked;
    setBusy(true);
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    const res = await setLike(c.id, next);
    setBusy(false);
    if (res.ok) {
      setLikes(res.likes);
      onLiked(c.id, res.liked, res.likes);
    } else {
      setLiked(!next);
      setLikes(c.likes);
      if (res.error === "unauthorized") return void (window.location.href = loginHere());
      onNote("Das liess sich gerade nicht speichern. Versuch es noch einmal.");
    }
  }

  return (
    <>
      {own ? (
        <span className="btn" aria-label={`${likes} ${likes === 1 ? "Like" : "Likes"}`}><Heart aria-hidden="true" /><span className="cm-like__n">{likes}</span></span>
      ) : (
        <button type="button" className="btn cm-like" aria-pressed={liked} onClick={() => void toggle()} disabled={busy}>
          <Heart aria-hidden="true" />
          <span className="lb-actions__label">{liked ? "Gefällt dir" : "Gefällt mir"}</span>
          <span className="cm-like__n">{likes}</span>
        </button>
      )}
      {showCreator && (
        <Link href={`/profile/${c.creator.handle}`} className="btn"><UserRound aria-hidden="true" /><span className="lb-actions__label">@{c.creator.handle}</span></Link>
      )}
      {!own && (
        <button type="button" className="btn" onClick={() => (guest ? void (window.location.href = loginHere()) : setReport(true))}>
          <Flag aria-hidden="true" /><span className="lb-actions__label">Melden</span>
        </button>
      )}
      {report && (
        <ReportDialog
          target={{ kind: "creation", jobId: c.id }}
          onClose={() => setReport(false)}
          onDone={(text) => {
            setReport(false);
            onNote(text);
          }}
        />
      )}
    </>
  );
}

/**
 * Public creations in the dense wall, each the one tile of every wall (`Shot`): only the picture at rest, creator,
 * likes and format on hover, a click opens it large with its prompt, «Prompt übernehmen», the mark that it is made with
 * AI, and like, the creator and «Melden». «Mehr laden» (and automatically when the end scrolls into view).
 * `ownHandle`: the viewer's own handle; `guest`: no login.
 */
export function CommunityWall({ feed, showCreator = true, ownHandle, guest = false, empty }: {
  feed: ReturnType<typeof useFeed>;
  showCreator?: boolean;
  ownHandle?: string | null;
  guest?: boolean;
  empty: React.ReactNode;
}) {
  const preview = usePreview();
  const [note, setNote] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const { items, next, status, busy, more, patch } = feed;

  // Loads the next page a little before the end comes into view.
  useEffect(() => {
    const el = end.current;
    if (!el || !next) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && void more(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, more]);

  const open = (i: number) =>
    preview.openEntries(
      items.map((c) => {
        const own = Boolean(ownHandle) && c.creator.handle === ownHandle;
        return {
          ...creationEntry(c),
          extra: (
            <CreationActions
              key={c.id}
              c={c}
              own={own}
              guest={guest}
              showCreator={showCreator}
              onLiked={(id, liked, likes) => patch(id, { liked, likes })}
              onNote={setNote}
            />
          ),
        };
      }),
      i,
    );

  if (status === "loading" && !items.length) return <p className="cm-note" role="status">Lade die Community …</p>;
  if (status === "failed") return <p className="cm-note" role="alert">Die Community ist gerade nicht erreichbar. Lade die Seite gleich noch einmal.</p>;
  if (!items.length) return <>{empty}</>;

  return (
    <>
      <Columns items={items} ratio={creationHeight} keyOf={(c) => c.id} min={170} dense>
        {(c, i) => {
          const label = (c.prompt ?? c.preset?.title ?? `${c.kind === "video" ? "Video" : "Bild"} von @${c.creator.handle}`).slice(0, 200);
          return (
            <Shot
              media={c.kind === "video" ? (
                <LoopVideo className="wall-shot__img" src={c.media.url} style={{ aspectRatio: String(1 / creationHeight(c)) }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="wall-shot__img" src={c.media.url} alt={label} loading="lazy" decoding="async" />
              )}
              title={label}
              facts={factsOf(c, showCreator)}
              onOpen={() => open(i)}
            />
          );
        }}
      </Columns>
      <div ref={end} className="cm-more">
        {next && <button type="button" className="cm-btn" onClick={() => void more()} disabled={busy}>{busy ? "Lade …" : "Mehr laden"}</button>}
      </div>
      {note && <Toast text={note} onDone={() => setNote(null)} />}
    </>
  );
}
