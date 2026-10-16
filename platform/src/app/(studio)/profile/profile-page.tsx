"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity, ArrowRight, ChevronRight, Coins, Eye, FolderOpen, Globe, Images, KeyRound, Lock, Pencil, Receipt, TriangleAlert, UserRound,
} from "lucide-react";
import { Avatar, ProfileDialog, useCommunity } from "@/components/studio/community";
import { hiddenText, visibilityOf } from "@/components/studio/community-view";
import { CreditMeter, fmt, useDailyUsage, useStatement } from "@/components/studio/credits";
import { JobCard, Lightbox } from "@/components/studio/job-views";
import { useBilling } from "@/components/studio/price-rows";
import { ratio } from "@/components/studio/schema";
import { useStudio, type Job } from "@/components/studio/studio-context";
import { Columns } from "@/components/studio/wall";
import { ORIGIN_LABEL } from "@/lib/credit-labels";
import { usageBreakdown } from "@/lib/usage";

type Show = "all" | "public" | "private";
type KindFilter = "all" | "image" | "video";
const SHOW: { id: Show; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "public", label: "Öffentlich" },
  { id: "private", label: "Privat" },
];
const KINDS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "Alles" },
  { id: "image", label: "Bilder" },
  { id: "video", label: "Videos" },
];
/** Tiles drawn at first and per «Mehr anzeigen»: a heavy account never renders thousands at once. */
const PAGE = 48;
const SINCE = new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "long" });
const isVideo = (j: Job) => j.outputs[0]?.contentType.startsWith("video/") ?? false;
const jobHeight = (j: Job) => 1 / ratio(j.params.aspect_ratio ?? (isVideo(j) ? "16:9" : "1:1"));

/**
 * The account's own profile: the community profile, the balance and what was used (details on /credits), the account, and every
 * finished creation with its switch between private and public. Private by default; only what is switched on shows
 * in the community.
 */
export function ProfilePage() {
  const { me, jobs, loaded } = useStudio();
  const community = useCommunity();
  const { statement } = useStatement();
  const [billing] = useBilling();
  const days = useDailyUsage(statement?.entries, 30);
  const usage = useMemo(() => usageBreakdown(statement?.entries ?? [], 4), [statement]);
  const [edit, setEdit] = useState(false);
  const [show, setShow] = useState<Show>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);
  const { profile, mine } = community;

  const done = useMemo(() => jobs.filter((j) => j.status === "succeeded" && j.outputs[0]), [jobs]);
  const counts = useMemo(() => {
    const c = { all: done.length, image: 0, video: 0, public: 0, private: 0, hidden: 0 };
    for (const j of done) {
      c[isVideo(j) ? "video" : "image"] += 1;
      const v = visibilityOf(mine, j.id);
      c[v === "public" ? "public" : "private"] += 1;
      if (v === "hidden") c.hidden += 1;
    }
    return c;
  }, [done, mine]);
  const shown = useMemo(
    () => done.filter((j) => {
      const v = visibilityOf(mine, j.id);
      return (show === "all" || (show === "public" ? v === "public" : v !== "public")) && (kind === "all" || (kind === "video") === isVideo(j));
    }),
    [done, mine, show, kind],
  );
  const page = shown.slice(0, limit);

  const spent30 = days.reduce((s, d) => s + d.credits, 0);
  const jobs30 = days.reduce((s, d) => s + d.jobs, 0);
  const peak = Math.max(1, ...days.map((d) => d.credits));
  const available = statement?.summary.available ?? me?.credits ?? null;
  const reserved = statement?.summary.reserved ?? 0;
  const sub = billing?.subscription;
  const plan = sub && ["active", "trialing", "past_due"].includes(sub.status) ? billing?.plans.find((p) => p.id === sub.planId) : undefined;
  const maxModel = Math.max(1, ...usage.models.map((m) => m.credits));
  const hidden = done.filter((j) => visibilityOf(mine, j.id) === "hidden");

  return (
    <div className="studio cm pf">
      <header className="pf-hero">
        <div className="pf-hero__who">
          <Avatar name={profile?.name ?? me?.email ?? "?"} src={profile?.avatar} size="lg" />
          <div className="pf-hero__copy">
            <div className="pf-hero__top">
              <span className="cm-kicker">Profil</span>
              {profile
                ? <span className="cm-badge"><Globe aria-hidden="true" />@{profile.handle}</span>
                : community.loaded && <span className="cm-badge"><Lock aria-hidden="true" />Privat</span>}
            </div>
            <h1>{profile?.name ?? "Dein Profil"}</h1>
            <p className="pf-hero__sub">
              {profile
                ? <>{profile.bio || "Noch keine Beschreibung."} <span className="pf-dim">· Dabei seit {SINCE.format(profile.since)}</span></>
                : me?.email}
            </p>
          </div>
        </div>
        {/* Without a profile the note below carries the one «Profil anlegen». */}
        {profile && (
          <div className="cm-head__actions">
            {!profile.hidden && <Link href={`/profile/${profile.handle}`} className="cm-btn"><Eye aria-hidden="true" /> Öffentliche Ansicht</Link>}
            <button type="button" className="cm-btn cm-btn--primary" onClick={() => setEdit(true)}><Pencil aria-hidden="true" /> Bearbeiten</button>
          </div>
        )}
      </header>

      {community.loaded && !profile && !community.failed && (
        <aside className="pf-callout">
          <Globe aria-hidden="true" />
          <p>
            <strong>Teile deine besten Kreationen in der Community.</strong> Lege dafür Namen und Handle fest. Was du teilst, sehen alle, auch ohne
            Anmeldung; alles andere bleibt privat, und deine E-Mail-Adresse zeigen wir nie.
          </p>
          <button type="button" className="cm-btn cm-btn--primary" onClick={() => setEdit(true)}><UserRound aria-hidden="true" /> Profil anlegen</button>
        </aside>
      )}

      {profile?.hidden && (
        <p className="pf-warn" role="status">
          <TriangleAlert aria-hidden="true" />
          Dein Profil und alles, was du geteilt hast, ist gerade nicht in der Community. {hiddenText(profile.hidden)}
        </p>
      )}

      <section className="pf-kpis" aria-label="Übersicht">
        <article className="pf-kpi">
          <span className="pf-kpi__label"><Coins aria-hidden="true" /> Guthaben</span>
          <strong className="pf-kpi__value">{available === null ? "–" : fmt(available)}</strong>
          <span className="pf-kpi__sub">
            {reserved > 0 ? `${fmt(reserved)} gerade reserviert` : statement?.expiring ? `${fmt(statement.expiring.credits)} Abo-Credits bis ${DAY.format(statement.expiring.at)}` : "Credits"}
          </span>
          <Link href="/credits#aufladen" className="pf-kpi__link">Aufladen <ArrowRight aria-hidden="true" /></Link>
        </article>
        <article className="pf-kpi">
          <span className="pf-kpi__label"><Activity aria-hidden="true" /> Verbrauch, 30 Tage</span>
          <strong className="pf-kpi__value">{statement ? fmt(spent30) : "–"}</strong>
          <span className="pf-kpi__sub">{jobs30} {jobs30 === 1 ? "Job" : "Jobs"}</span>
          <span className="pf-spark" aria-hidden="true">
            {days.map((d) => <i key={d.start} style={{ "--h": d.credits / peak } as React.CSSProperties} data-zero={d.credits === 0 || undefined} />)}
          </span>
        </article>
        <article className="pf-kpi">
          <span className="pf-kpi__label"><Images aria-hidden="true" /> Kreationen</span>
          <strong className="pf-kpi__value">{loaded ? fmt(counts.all) : "–"}</strong>
          <span className="pf-kpi__sub">{counts.image} {counts.image === 1 ? "Bild" : "Bilder"} · {counts.video} {counts.video === 1 ? "Video" : "Videos"}</span>
          <Link href="/assets" className="pf-kpi__link">Assets <ArrowRight aria-hidden="true" /></Link>
        </article>
        <article className="pf-kpi">
          <span className="pf-kpi__label"><Globe aria-hidden="true" /> In der Community</span>
          <strong className="pf-kpi__value">{community.loaded ? fmt(counts.public) : "–"}</strong>
          <span className="pf-kpi__sub">
            {community.stats && (counts.public || community.stats.followers)
              ? `${fmt(community.stats.likes)} ${community.stats.likes === 1 ? "Like" : "Likes"} · ${fmt(community.stats.followers)} Follower`
              : counts.public ? "öffentlich" : "Noch nichts geteilt"}
          </span>
          <Link href="/community" className="pf-kpi__link">Community <ArrowRight aria-hidden="true" /></Link>
        </article>
      </section>

      <div className="pf-grid">
        <section className="pf-panel" aria-labelledby="pf-usage">
          <header className="pf-panel__head">
            <h2 id="pf-usage">Nutzung</h2>
            <Link href="/credits" className="cm-btn cm-btn--quiet cm-btn--sm">Kontoauszug <ArrowRight aria-hidden="true" /></Link>
          </header>
          {statement ? <CreditMeter summary={statement.summary} /> : <p className="cm-note">Lade die Nutzung …</p>}
          <div className="pf-usage">
            <div>
              <h3 className="pf-label">Nach Modell</h3>
              {usage.models.length ? (
                <ul className="pf-bars">
                  {usage.models.map((m) => (
                    <li key={m.key}>
                      <span className="pf-bars__name">{m.model}</span>
                      <span className="pf-bars__track" aria-hidden="true"><span style={{ inlineSize: `${(m.credits / maxModel) * 100}%` }} /></span>
                      <span className="pf-bars__value">{fmt(m.credits)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cm-note">Sobald ein Job abgebucht ist, siehst du hier, welches Modell wie viel kostet.</p>
              )}
            </div>
            <div>
              <h3 className="pf-label">Nach Kanal</h3>
              {usage.origins.length ? (
                <ul className="pf-rows">
                  {usage.origins.map((o) => (
                    <li key={o.origin}><span>{ORIGIN_LABEL[o.origin]}</span><span className="pf-dim">{o.jobs} {o.jobs === 1 ? "Job" : "Jobs"}</span><strong>{fmt(o.credits)}</strong></li>
                  ))}
                  {usage.director.messages > 0 && (
                    <li><span>Director</span><span className="pf-dim">{usage.director.messages} {usage.director.messages === 1 ? "Nachricht" : "Nachrichten"}</span><strong>{fmt(usage.director.credits)}</strong></li>
                  )}
                </ul>
              ) : (
                <p className="cm-note">Studio, MCP, CLI und API: hier steht, wo du Credits ausgibst.</p>
              )}
            </div>
          </div>
        </section>

        <section className="pf-panel" aria-labelledby="pf-account">
          <header className="pf-panel__head"><h2 id="pf-account">Konto</h2></header>
          <dl className="pf-facts">
            <div><dt>E-Mail</dt><dd>{me?.email ?? "–"}</dd></div>
            <div><dt>Abo</dt><dd>{plan ? `${fmt(plan.credits)} Credits im Monat` : "Kein Abo"}</dd></div>
            <div><dt>Community</dt><dd>{profile ? `@${profile.handle}` : "Kein Profil"}</dd></div>
            <div><dt>Prompts</dt><dd>{profile ? (profile.showPrompts ? "werden gezeigt" : "bleiben privat") : "–"}</dd></div>
          </dl>
          <nav className="pf-links" aria-label="Konto">
            <Link href="/credits"><Receipt aria-hidden="true" /> Credits und Kontoauszug <ChevronRight aria-hidden="true" /></Link>
            <Link href="/settings/api"><KeyRound aria-hidden="true" /> API &amp; MCP <ChevronRight aria-hidden="true" /></Link>
          </nav>
        </section>
      </div>

      <section className="pf-works" id="kreationen" aria-labelledby="pf-works-title">
        <div className="pf-works__head">
          <h2 id="pf-works-title">Kreationen</h2>
          <p>Öffne ein Bild oder Video gross und tippe auf «Teilen», dann sehen es alle in der Community. Unter «Öffentlich» zeigst du den Prompt oder machst es wieder privat. Alles andere bleibt privat.</p>
        </div>
        <div className="cm-bar">
          <div className="cm-tabs" role="tablist" aria-label="Sichtbarkeit">
            {SHOW.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={show === s.id} className="cm-tab" onClick={() => { setShow(s.id); setLimit(PAGE); }}>
                {s.label}<span className="cm-tab__n">{counts[s.id]}</span>
              </button>
            ))}
          </div>
          <div className="cm-tabs" role="tablist" aria-label="Art">
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} className="cm-tab" onClick={() => { setKind(k.id); setLimit(PAGE); }}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        {hidden.length > 0 && (
          <p className="pf-warn" role="status">
            <TriangleAlert aria-hidden="true" />
            {hidden.length === 1 ? "Eine Kreation ist" : `${hidden.length} Kreationen sind`} nicht in der Community: {hiddenText(mine.get(hidden[0]!.id)?.reason)}
          </p>
        )}

        {page.length ? (
          <>
            <Columns items={page} ratio={jobHeight} keyOf={(j) => j.id} min={240} dense>
              {(j, i) => <JobCard job={j} onOpen={() => setOpen(i)} />}
            </Columns>
            {shown.length > page.length && (
              <div className="cm-more">
                <button type="button" className="cm-btn" onClick={() => setLimit((l) => l + PAGE)}>Mehr anzeigen ({shown.length - page.length})</button>
              </div>
            )}
          </>
        ) : loaded ? (
          <div className="cm-empty">
            <FolderOpen aria-hidden="true" />
            <strong>{done.length ? (show === "public" ? "Noch nichts geteilt" : "Nichts in dieser Auswahl") : "Noch keine Kreationen"}</strong>
            <p>
              {done.length
                ? show === "public" ? "Öffne ein Bild oder Video gross und tippe auf «Teilen», dann erscheint es hier und in der Community." : "Wähle eine andere Auswahl."
                : "Hier landen deine Bilder und Videos, sobald sie fertig sind."}
            </p>
            {!done.length && <p className="pf-links-inline"><Link href="/image">Bild erstellen</Link> · <Link href="/video">Video erstellen</Link></p>}
          </div>
        ) : null}
      </section>

      {open !== null && <Lightbox jobs={page} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
      {edit && <ProfileDialog onClose={() => setEdit(false)} />}
    </div>
  );
}
