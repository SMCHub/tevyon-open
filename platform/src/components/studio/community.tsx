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
        <button type="button" className="cm-iconbtn" onClick={onClose} aria-label="Schliessen"><X /></button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}

/**
 * Create or change the community profile, with an optional picture (uploaded and scanned like every upload). A new one
 * asks for the rules once (rights, consent of depicted persons, Nutzungsrichtlinien); `then` names what happens after
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
    if (!res.ok) return setError(PROFILE_ERROR[res.error] ?? "Das Profil liess sich nicht speichern. Versuch es noch einmal.");
    if (onSaved) onSaved(res.profile);
    else onClose();
  }

  async function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    const res = await deleteProfile();
    setBusy(false);
    if (!res.ok) return setError(PROFILE_ERROR[res.error] ?? "Das Profil liess sich nicht löschen. Versuch es noch einmal.");
    onClose();
  }

  const clean = handle.trim().replace(/^@/, "").toLowerCase();
  const shown = avatar === undefined ? profile?.avatar ?? null : avatar;
  return (
    <Dialog title={profile ? "Profil bearbeiten" : "Community-Profil anlegen"} icon={<UserRound />} onClose={onClose}>
      <form className="cm-dialog__form" onSubmit={submit}>
        <p className="cm-dialog__lead">
          {profile ? "So erscheinst du in der Community." : "So erscheinst du in der Community, wenn du etwas teilst. Deine E-Mail-Adresse bleibt privat."}
          {" "}Dein Profil und alles, was du teilst, ist für alle sichtbar, auch ohne Anmeldung, und kann in Suchmaschinen erscheinen.
          {then ? ` ${then}` : ""}
        </p>
        <div className="cm-avatar-row">
          <Avatar name={name || handle || "?"} src={shown} size="lg" />
          <div className="cm-avatar-row__actions">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" className="cm-btn cm-btn--sm" onClick={() => file.current?.click()} disabled={uploading}>
              <ImagePlus aria-hidden="true" /> {uploading ? "Lädt hoch …" : shown ? "Bild ändern" : "Bild wählen"}
            </button>
            {shown && <button type="button" className="cm-btn cm-btn--sm cm-btn--quiet" onClick={() => setAvatar(null)}>Entfernen</button>}
            <small>Optional. Jedes Bild wird vor dem Speichern geprüft.</small>
          </div>
        </div>
        <label className="cm-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus placeholder="z. B. Lena Muster" autoComplete="nickname" />
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
          <small id="cm-handle-hint">3 bis 20 Zeichen: a–z, 0–9 und _. Dein Profil: /profile/{clean || "handle"}</small>
        </label>
        <label className="cm-field">
          <span>Über dich <em className="cm-count">{[...bio].length}/160</em></span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} rows={2} placeholder="Was du erstellst, in einem Satz." />
        </label>
        <label className="cm-check">
          <input type="checkbox" checked={showPrompts} onChange={(e) => setShowPrompts(e.target.checked)} />
          <span>
            <strong>Prompts zeigen</strong>
            Andere können den Prompt deiner geteilten Kreationen übernehmen. Gilt für alles, was du ab jetzt teilst; je Kreation änderbar.
          </span>
        </label>
        {!profile && (
          <label className="cm-check">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} required />
            <span>
              <strong>Community-Regeln</strong>
              Ich teile nur, woran ich die Rechte habe, und erkennbare Personen nur mit ihrer Einwilligung. Es gelten die{" "}
              <a href={`${LANDING}/richtlinien`} target="_blank" rel="noreferrer">Nutzungsrichtlinien</a>.
            </span>
          </label>
        )}
        {error && <p className="cm-error" role="alert">{error}</p>}
        <div className="cm-dialog__actions">
          {profile && (
            <button type="button" className="cm-btn cm-btn--quiet cm-btn--danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 aria-hidden="true" /> {confirmDelete ? "Wirklich löschen? Alles Geteilte wird privat." : "Profil löschen"}
            </button>
          )}
          <span className="cm-dialog__spacer" />
          <button type="button" className="cm-btn cm-btn--quiet" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="cm-btn cm-btn--primary" disabled={busy || uploading}>
            {busy ? "Speichere …" : profile ? "Speichern" : then ? "Anlegen und teilen" : "Profil anlegen"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asked once before a result made from the account's own photo or video goes public. */
function ConsentDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog title="Aus deinem Foto entstanden" icon={<Globe />} onClose={onCancel}>
      <div className="cm-dialog__form">
        <p className="cm-dialog__lead">
          Dieses Ergebnis entstand aus einer Datei, die du hochgeladen hast. Teile es nur, wenn du die Rechte daran hast und jede erkennbare Person
          damit einverstanden ist, dass es öffentlich zu sehen ist. Deine hochgeladene Datei selbst bleibt privat.
        </p>
        <div className="cm-dialog__actions">
          <button type="button" className="cm-btn cm-btn--quiet" onClick={onCancel}>Abbrechen</button>
          <button type="button" className="cm-btn cm-btn--primary" onClick={onConfirm} autoFocus>Einverstanden, teilen</button>
        </div>
      </div>
    </Dialog>
  );
}

export const REASONS: { id: ReportReason; label: string }[] = [
  { id: "rights", label: "Verletzt Urheber-, Marken- oder andere Rechte" },
  { id: "person", label: "Zeigt eine reale Person ohne Einwilligung" },
  { id: "sexual", label: "Sexuelle Inhalte" },
  { id: "violence", label: "Gewalt, Hass oder Hetze" },
  { id: "minors", label: "Gefährdet oder zeigt Minderjährige" },
  { id: "other", label: "Etwas anderes" },
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
    if (!reason) return setError("Wähle einen Grund.");
    setBusy(true);
    const url = profile ? `/api/community/${encodeURIComponent(target.handle)}/report` : `/api/publications/${target.jobId}/report`;
    const res = await call<Res>(url, { method: "POST", body: JSON.stringify({ reason, note }) });
    setBusy(false);
    if (res.ok || res.error === "not_found") return onDone("Danke für die Meldung. Wir sehen es uns an.");
    if (res.error === "unauthorized") return void (window.location.href = loginHere());
    setError(res.error === "storage_unavailable" ? PUBLISH_ERROR.storage_unavailable! : "Die Meldung liess sich nicht senden. Versuch es noch einmal.");
  }

  return (
    <Dialog title={profile ? "Profil melden" : "Kreation melden"} icon={<Flag />} onClose={onClose}>
      <form className="cm-dialog__form" onSubmit={submit}>
        <fieldset className="cm-field">
          <legend>{profile ? "Was stimmt mit dem Profil nicht (Name, Bild, Beschreibung)?" : "Was stimmt nicht?"}</legend>
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
          <span>Hinweis <em className="cm-count">freiwillig</em></span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Was sollen wir wissen?" />
        </label>
        <p className="cm-dialog__fine">
          {profile
            ? "Ein Mensch prüft die Meldung. Wer gemeldet wird, erfährt nicht, wer gemeldet hat."
            : "Nach mehreren Meldungen nehmen wir die Kreation vorläufig aus der Community, bis ein Mensch sie geprüft hat."}
        </p>
        {error && <p className="cm-error" role="alert">{error}</p>}
        <div className="cm-dialog__actions">
          <button type="button" className="cm-btn cm-btn--quiet" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="cm-btn cm-btn--primary" disabled={busy}>{busy ? "Sende …" : "Melden"}</button>
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
    onNote(res.ok ? (showPrompt ? "Der Prompt ist jetzt verborgen." : "Der Prompt ist jetzt sichtbar.") : PUBLISH_ERROR[res.error] ?? "Das liess sich gerade nicht ändern.");
  }
  async function hide() {
    setBusy(true);
    const res = await unpublishJob(jobId);
    setBusy(false);
    onClose();
    onNote(res.ok ? "Wieder privat." : PUBLISH_ERROR[res.error] ?? "Das liess sich gerade nicht ändern.");
  }

  return createPortal(
    <div ref={panel} className="cm cm-menu" role="menu" aria-label="In der Community" style={pos} onClick={(e) => e.stopPropagation()}>
      <p className="cm-menu__head"><Globe aria-hidden="true" /> In der Community</p>
      <button type="button" role="menuitemcheckbox" aria-checked={showPrompt} className="cm-menu__item" onClick={() => void prompt()} disabled={busy}>
        <span className="cm-menu__switch" data-on={showPrompt || undefined} aria-hidden="true" />
        Prompt zeigen
      </button>
      <button type="button" role="menuitem" className="cm-menu__item" onClick={() => void hide()} disabled={busy}>
        <Lock aria-hidden="true" /> Wieder privat
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
    if (res.ok) return setNote("Geteilt: in der Community sichtbar.");
    if (res.error === "profile_required") return setDialog("profile");
    if (res.error === "consent_required") return setDialog("consent");
    setNote(PUBLISH_ERROR[res.error] ?? "Das liess sich gerade nicht teilen. Versuch es noch einmal.");
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

  const label = now === "public" ? "Öffentlich in der Community. Prompt und Sichtbarkeit ändern" : now === "hidden" ? "Ausgeblendet" : "Privat. In der Community teilen";
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
        {labelled && <span className="lb-actions__label">{now === "public" ? "Öffentlich" : now === "hidden" ? "Ausgeblendet" : "Teilen"}</span>}
      </button>
      {menu && now === "public" && <PublicMenu jobId={jobId} at={menu} onClose={() => setMenu(null)} onNote={setNote} />}
      {dialog === "profile" && (
        <ProfileDialog
          then="Danach ist dein Ergebnis in der Community sichtbar."
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
