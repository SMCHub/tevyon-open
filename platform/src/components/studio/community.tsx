"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { EyeOff, Flag, Globe, ImagePlus, Lock, Trash2, UserRound, X } from "lucide-react";
import type { OwnPublication, Profile, ReportReason } from "@/core/community";
import { PROFILE_ERROR, PUBLISH_ERROR, hiddenText, initial, visibilityOf } from "./community-view";
import { uploadImage } from "./upload";
import "./community.css";

/**
 * The community in the browser (core/community.ts on the server): the account's profile, which of its creations are
 * public and its numbers, shared by every component on a page (one /api/profile per page load); the switch that
 * publishes a result; likes and follows; and the dialogs it needs (profile, consent, report). Dialogs, menus and the
 * status line render on <body>, so a dark tile overlay never tints them.
 */

export type CommunityStats = { followers: number; following: number; likes: number };
type State = {
  loaded: boolean; failed: boolean; profile: Profile | null; mine: ReadonlyMap<string, OwnPublication>;
  /** The account's own numbers (followers, followed accounts, likes received). */
  stats: CommunityStats | null;
  /** Whether the account moderates the community (/moderation). */
  operator: boolean;
};
const EMPTY: State = { loaded: false, failed: false, profile: null, mine: new Map(), stats: null, operator: false };
let state: State = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Reads the profile, the account's publications and its numbers once per page load (again with `force`). */
export function loadCommunity(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = fetch("/api/profile", { cache: "no-store" })
    .then(async (r) => {
      const d = (await r.json().catch(() => null)) as
        | { ok?: boolean; profile?: Profile | null; publications?: OwnPublication[]; stats?: CommunityStats; operator?: boolean }
        | null;
      if (!r.ok || !d?.ok) return set({ loaded: true, failed: true });
      set({
        loaded: true, failed: false, profile: d.profile ?? null, mine: new Map((d.publications ?? []).map((p) => [p.jobId, p])),
        stats: d.stats ?? null, operator: d.operator === true,
      });
    })
    .catch(() => set({ loaded: true, failed: true }));
  return loading;
}

/** The account's profile and publications, loaded on first use and shared by every component. */
export function useCommunity(): State {
  const s = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    void loadCommunity();
  }, []);
  return s;
}

type Res<E extends string = string> = { ok: true } | { ok: false; error: E | "storage_unavailable" | "unauthorized" | "unknown" };

async function call<T>(url: string, init: RequestInit): Promise<T | { ok: false; error: "unknown" }> {
  try {
    const r = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
    return ((await r.json().catch(() => null)) ?? { ok: false, error: "unknown" }) as T;
  } catch {
    return { ok: false, error: "unknown" };
  }
}

/** Where a visitor without a login goes to sign in, and comes back to this page. */
export const loginHere = () => `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;

export async function publishJob(jobId: string, opts: { showPrompt?: boolean; consent?: boolean } = {}) {
  const res = await call<{ ok: true; publication: OwnPublication } | { ok: false; error: string }>(`/api/publications/${jobId}`, {
    method: "PUT",
    body: JSON.stringify(opts),
  });
  if (res.ok) set({ mine: new Map(state.mine).set(jobId, res.publication) });
  return res;
}

export async function unpublishJob(jobId: string): Promise<Res> {
  const before = state.mine;
  const mine = new Map(before);
  const p = mine.get(jobId);
  // Private at once; a hidden one keeps its mark (moderation decides that, not the owner).
  if (p?.state === "hidden") mine.set(jobId, { ...p, publishedAt: null });
  else mine.delete(jobId);
  set({ mine });
  const res = await call<Res>(`/api/publications/${jobId}`, { method: "DELETE" });
  if (!res.ok) set({ mine: before });
  return res;
}

/** avatar: undefined keeps the picture, null removes it, else one of the account's own image uploads. */
export async function saveProfile(input: { name: string; handle: string; bio: string; showPrompts: boolean; acceptTerms?: boolean; avatar?: string | null }) {
  const res = await call<{ ok: true; profile: Profile } | { ok: false; error: string }>("/api/profile", { method: "PUT", body: JSON.stringify(input) });
  if (res.ok) set({ profile: res.profile });
  return res;
}

/** Deletes the community profile: everything shared goes private again (creations stay the account's own). */
export async function deleteProfile(): Promise<Res> {
  const res = await call<Res>("/api/profile", { method: "DELETE" });
  if (res.ok) await loadCommunity(true);
  return res;
}

/** Likes (on) or unlikes a public creation; the count after it. */
export function setLike(jobId: string, on: boolean) {
  return call<{ ok: true; liked: boolean; likes: number } | { ok: false; error: string }>(`/api/publications/${jobId}/like`, { method: on ? "PUT" : "DELETE" });
}

/** Follows (on) or unfollows a creator; their follower count after it. */
export async function setFollow(handle: string, on: boolean) {
  const res = await call<{ ok: true; following: boolean; followers: number } | { ok: false; error: string }>(`/api/community/${encodeURIComponent(handle)}/follow`, {
    method: on ? "PUT" : "DELETE",
  });
  if (res.ok && state.stats) set({ stats: { ...state.stats, following: Math.max(0, state.stats.following + (on ? 1 : -1)) } });
  return res;
}

const LANDING = (process.env.NEXT_PUBLIC_LANDING_URL ?? "https://tachyon-landing.vercel.app").replace(/\/$/, "");

/** A round avatar: the profile's picture, else the first letter of the name. */
export function Avatar({ name, src, size = "sm" }: { name: string; src?: string | null; size?: "sm" | "md" | "lg" }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img className={`cm-avatar cm-avatar--${size}`} src={src} alt="" />;
  return <span className={`cm-avatar cm-avatar--${size}`} aria-hidden="true">{initial(name)}</span>;
}

/** A short status line at the foot of the screen; gone after a few seconds. */
export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  // The timer follows the text only; a parent that renders again (polling) does not restart it.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const t = setTimeout(() => done.current(), 3200);
    return () => clearTimeout(t);
  }, [text]);
  return createPortal(<p className="cm-toast" role="status">{text}</p>, document.body);
}

/** A modal on <body>: opens on mount, Escape and the backdrop close it. Clicks inside never reach the tile behind. */
function Dialog({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="cm cm-dialog"
      aria-labelledby="cm-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="cm-dialog__head">
        <span className="cm-dialog__icon" aria-hidden="true">{icon}</span>
        <h2 id="cm-dialog-title">{title}</h2>
        <button type="button" className="cm-iconbtn" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}

/**
 * Create or change the community profile, with an optional picture (uploaded and scanned like every upload). A new one
 * asks for the rules once (rights, consent of depicted persons, usage policy); `then` names what happens after
 * saving (publishing a result). An existing one can be deleted here, in two steps.
 */
export function ProfileDialog({ onClose, onSaved, then }: { onClose: () => void; onSaved?: (p: Profile) => void; then?: string }) {
  const { profile } = useCommunity();
  const [name, setName] = useState(profile?.name ?? "");
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [showPrompts, setShowPrompts] = useState(profile?.showPrompts ?? true);
  // undefined: keep the picture; null: remove it; a string: a new upload.
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    setError(null);
    const res = await uploadImage(f);
    setUploading(false);
    if ("error" in res) return setError(res.error);
    setAvatar(res.url);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await saveProfile({ name, handle, bio, showPrompts, ...(avatar !== undefined ? { avatar } : {}), ...(profile ? {} : { acceptTerms: accept }) });
    setBusy(false);
    if (!res.ok) return setError(PROFILE_ERROR[res.error] ?? "The profile couldn't be saved. Please try again.");
    if (onSaved) onSaved(res.profile);
    else onClose();
  }

  async function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    const res = await deleteProfile();
    setBusy(false);
    if (!res.ok) return setError(PROFILE_ERROR[res.error] ?? "The profile couldn't be deleted. Please try again.");
    onClose();
  }

  const clean = handle.trim().replace(/^@/, "").toLowerCase();
  const shown = avatar === undefined ? profile?.avatar ?? null : avatar;
  return (
    <Dialog title={profile ? "Edit profile" : "Create Community profile"} icon={<UserRound />} onClose={onClose}>
      <form className="cm-dialog__form" onSubmit={submit}>
        <p className="cm-dialog__lead">
          {profile ? "This is how you appear in the Community." : "This is how you appear in the Community when you share something. Your email address stays private."}
          {" "}Your profile and everything you share is visible to everyone, even without signing in, and can appear in search engines.
          {then ? ` ${then}` : ""}
        </p>
        <div className="cm-avatar-row">
          <Avatar name={name || handle || "?"} src={shown} size="lg" />
          <div className="cm-avatar-row__actions">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" className="cm-btn cm-btn--sm" onClick={() => file.current?.click()} disabled={uploading}>
              <ImagePlus aria-hidden="true" /> {uploading ? "Uploading …" : shown ? "Change picture" : "Choose picture"}
            </button>
            {shown && <button type="button" className="cm-btn cm-btn--sm cm-btn--quiet" onClick={() => setAvatar(null)}>Remove</button>}
            <small>Optional. Every picture is checked before it is saved.</small>
          </div>
        </div>
        <label className="cm-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus placeholder="e.g. Lena Smith" autoComplete="nickname" />
        </label>
        <label className="cm-field">
          <span>Handle</span>
          <span className="cm-input-at">
            <span aria-hidden="true">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              maxLength={21}
              required
              placeholder="lena_creates"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="cm-handle-hint"
            />
          </span>
          <small id="cm-handle-hint">3 to 20 characters: a–z, 0–9 and _. Your profile: /profile/{clean || "handle"}</small>
        </label>
        <label className="cm-field">
          <span>About you <em className="cm-count">{[...bio].length}/160</em></span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} rows={2} placeholder="What you create, in one sentence." />
        </label>
        <label className="cm-check">
          <input type="checkbox" checked={showPrompts} onChange={(e) => setShowPrompts(e.target.checked)} />
          <span>
            <strong>Show prompts</strong>
            Others can reuse the prompt of your shared creations. Applies to everything you share from now on; changeable per creation.
          </span>
        </label>
        {!profile && (
          <label className="cm-check">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} required />
            <span>
              <strong>Community rules</strong>
              I only share what I hold the rights to, and recognizable people only with their consent. The{" "}
              <a href={`${LANDING}/richtlinien`} target="_blank" rel="noreferrer">usage policy</a> applies.
            </span>
          </label>
        )}
        {error && <p className="cm-error" role="alert">{error}</p>}
        <div className="cm-dialog__actions">
          {profile && (
            <button type="button" className="cm-btn cm-btn--quiet cm-btn--danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 aria-hidden="true" /> {confirmDelete ? "Really delete? Everything shared goes private." : "Delete profile"}
            </button>
          )}
          <span className="cm-dialog__spacer" />
          <button type="button" className="cm-btn cm-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="cm-btn cm-btn--primary" disabled={busy || uploading}>
            {busy ? "Saving …" : profile ? "Save" : then ? "Create and share" : "Create profile"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asked once before a result made from the account's own photo or video goes public. */
function ConsentDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog title="Made from your photo" icon={<Globe />} onClose={onCancel}>
      <div className="cm-dialog__form">
        <p className="cm-dialog__lead">
          This result was made from a file you uploaded. Only share it if you hold the rights to it and every recognizable person
          agrees to it being shown publicly. Your uploaded file itself stays private.
        </p>
        <div className="cm-dialog__actions">
          <button type="button" className="cm-btn cm-btn--quiet" onClick={onCancel}>Cancel</button>
          <button type="button" className="cm-btn cm-btn--primary" onClick={onConfirm} autoFocus>Agree and share</button>
        </div>
      </div>
    </Dialog>
  );
}

export const REASONS: { id: ReportReason; label: string }[] = [
  { id: "rights", label: "Infringes copyright, trademark or other rights" },
  { id: "person", label: "Shows a real person without consent" },
  { id: "sexual", label: "Sexual content" },
  { id: "violence", label: "Violence, hate or incitement" },
  { id: "minors", label: "Endangers or shows minors" },
  { id: "other", label: "Something else" },
];

export type ReportTarget = { kind: "creation"; jobId: string } | { kind: "profile"; handle: string };

/** Reports someone else's creation or profile: a reason and an optional note; a person looks at it. */
export function ReportDialog({ target, onClose, onDone }: { target: ReportTarget; onClose: () => void; onDone: (text: string) => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = target.kind === "profile";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return setError("Choose a reason.");
    setBusy(true);
    const url = profile ? `/api/community/${encodeURIComponent(target.handle)}/report` : `/api/publications/${target.jobId}/report`;
    const res = await call<Res>(url, { method: "POST", body: JSON.stringify({ reason, note }) });
    setBusy(false);
    if (res.ok || res.error === "not_found") return onDone("Thanks for the report. We'll take a look.");
    if (res.error === "unauthorized") return void (window.location.href = loginHere());
    setError(res.error === "storage_unavailable" ? PUBLISH_ERROR.storage_unavailable! : "The report couldn't be sent. Please try again.");
  }

  return (
    <Dialog title={profile ? "Report profile" : "Report creation"} icon={<Flag />} onClose={onClose}>
      <form className="cm-dialog__form" onSubmit={submit}>
        <fieldset className="cm-field">
          <legend>{profile ? "What's wrong with this profile (name, picture, bio)?" : "What's wrong?"}</legend>
          <div className="cm-reasons">
            {REASONS.map((r) => (
              <label key={r.id} className="cm-reason">
                <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="cm-field">
          <span>Note <em className="cm-count">optional</em></span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="What should we know?" />
        </label>
        <p className="cm-dialog__fine">
          {profile
            ? "A person reviews the report. Whoever is reported never learns who reported them."
            : "After several reports we take the creation out of the Community until a person has reviewed it."}
        </p>
        {error && <p className="cm-error" role="alert">{error}</p>}
        <div className="cm-dialog__actions">
          <button type="button" className="cm-btn cm-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="cm-btn cm-btn--primary" disabled={busy}>{busy ? "Sending …" : "Report"}</button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * What a public creation offers its owner: show its prompt or not, and make it private again. A small menu on <body>
 * beside the switch, above it when there is room; Escape and a click elsewhere close it.
 */
function PublicMenu({ jobId, at, onClose, onNote }: { jobId: string; at: DOMRect; onClose: () => void; onNote: (t: string) => void }) {
  const { mine } = useCommunity();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [busy, setBusy] = useState(false);
  const showPrompt = mine.get(jobId)?.showPrompt ?? true;

  useLayoutEffect(() => {
    const h = panel.current?.offsetHeight ?? 120;
    const w = panel.current?.offsetWidth ?? 260;
    const left = Math.max(8, Math.min(at.left, window.innerWidth - w - 8));
    setPos(at.top > h + 16 ? { left, top: at.top - h - 8 } : { left, top: Math.min(at.bottom + 8, window.innerHeight - h - 8) });
  }, [at]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The menu closes, not the preview behind it.
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  async function prompt() {
    setBusy(true);
    const res = await publishJob(jobId, { showPrompt: !showPrompt });
    setBusy(false);
    onNote(res.ok ? (showPrompt ? "The prompt is now hidden." : "The prompt is now visible.") : PUBLISH_ERROR[res.error] ?? "That couldn't be changed just now.");
  }
  async function hide() {
    setBusy(true);
    const res = await unpublishJob(jobId);
    setBusy(false);
    onClose();
    onNote(res.ok ? "Private again." : PUBLISH_ERROR[res.error] ?? "That couldn't be changed just now.");
  }

  return createPortal(
    <div ref={panel} className="cm cm-menu" role="menu" aria-label="In the Community" style={pos} onClick={(e) => e.stopPropagation()}>
      <p className="cm-menu__head"><Globe aria-hidden="true" /> In the Community</p>
      <button type="button" role="menuitemcheckbox" aria-checked={showPrompt} className="cm-menu__item" onClick={() => void prompt()} disabled={busy}>
        <span className="cm-menu__switch" data-on={showPrompt || undefined} aria-hidden="true" />
        Show prompt
      </button>
      <button type="button" role="menuitem" className="cm-menu__item" onClick={() => void hide()} disabled={busy}>
        <Lock aria-hidden="true" /> Make private
      </button>
    </div>,
    document.body,
  );
}

/**
 * The community switch on one of the account's own results (the preview's actions, `labelled`): a lock while private,
 * a globe while public. Publishing asks for a profile first if there is none, and for consent if the result came from
 * an upload; a public one opens a small menu (prompt shown or not, private again).
 */
export function VisibilityButton({ jobId, className = "icon-btn", labelled = false }: { jobId: string; className?: string; labelled?: boolean }) {
  const community = useCommunity();
  const now = visibilityOf(community.mine, jobId);
  const [dialog, setDialog] = useState<null | "profile" | "consent">(null);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function publish(consent = false) {
    setBusy(true);
    const res = await publishJob(jobId, consent ? { consent: true } : {});
    setBusy(false);
    if (res.ok) return setNote("Shared: visible in the Community.");
    if (res.error === "profile_required") return setDialog("profile");
    if (res.error === "consent_required") return setDialog("consent");
    setNote(PUBLISH_ERROR[res.error] ?? "That couldn't be shared just now. Please try again.");
  }

  async function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (busy) return;
    if (now === "hidden") return setNote(hiddenText(community.mine.get(jobId)?.reason));
    if (now === "public") return setMenu(menu ? null : e.currentTarget.getBoundingClientRect());
    await loadCommunity();
    if (!state.profile) return setDialog("profile");
    await publish();
  }

  const label = now === "public" ? "Public in the Community. Change prompt and visibility" : now === "hidden" ? "Hidden" : "Private. Share in the Community";
  return (
    <>
      <button
        type="button"
        className={`${className} cm-vis`}
        data-state={now}
        aria-pressed={now === "public"}
        aria-haspopup={now === "public" ? "menu" : undefined}
        aria-expanded={now === "public" ? Boolean(menu) : undefined}
        aria-label={label}
        title={label}
        onClick={toggle}
        disabled={busy}
      >
        {now === "public" ? <Globe /> : now === "hidden" ? <EyeOff /> : <Lock />}
        {/* `labelled`: the preview's action row, with the state in words. */}
        {labelled && <span className="lb-actions__label">{now === "public" ? "Public" : now === "hidden" ? "Hidden" : "Share"}</span>}
      </button>
      {menu && now === "public" && <PublicMenu jobId={jobId} at={menu} onClose={() => setMenu(null)} onNote={setNote} />}
      {dialog === "profile" && (
        <ProfileDialog
          then="Your result will then be visible in the Community."
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void publish();
          }}
        />
      )}
      {dialog === "consent" && (
        <ConsentDialog
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void publish(true);
          }}
        />
      )}
      {note && <Toast text={note} onDone={() => setNote(null)} />}
    </>
  );
}
