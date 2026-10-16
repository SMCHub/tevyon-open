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
  { id: "all", label: "All" },
  { id: "public", label: "Public" },
  { id: "private", label: "Private" },
];
const KINDS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Videos" },
];
/** Tiles drawn at first and per “Show more”: a heavy account never renders thousands at once. */
const PAGE = 48;
const SINCE = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long" });
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
              <span className="cm-kicker">Profile</span>
              {profile
                ? <span className="cm-badge"><Globe aria-hidden="true" />@{profile.handle}</span>
                : community.loaded && <span className="cm-badge"><Lock aria-hidden="true" />Private</span>}
            </div>
            <h1>{profile?.name ?? "Your profile"}</h1>
            <p className="pf-hero__sub">
              {profile
                ? <>{profile.bio || "No bio yet."} <span className="pf-dim">· Joined {SINCE.format(profile.since)}</span></>
                : me?.email}
            </p>
          </div>
        </div>
        {/* Without a profile the note below carries the one “Create profile”. */}
        {profile && (
          <div className="cm-head__actions">
            {!profile.hidden && <Link href={`/profile/${profile.handle}`} className="cm-btn"><Eye aria-hidden="true" /> Public view</Link>}
            <button type="button" className="cm-btn cm-btn--primary" onClick={() => setEdit(true)}><Pencil aria-hidden="true" /> Edit</button>
          </div>
        )}
      </header>

      {community.loaded && !profile && !community.failed && (
        <aside className="pf-callout">
          <Globe aria-hidden="true" />
          <p>
            <strong>Share your best creations in the Community.</strong> Pick a name and handle for it. What you share is visible to everyone, even
            without signing in; everything else stays private, and we never show your email address.
          </p>
          <button type="button" className="cm-btn cm-btn--primary" onClick={() => setEdit(true)}><UserRound aria-hidden="true" /> Create profile</button>
        </aside>
      )}

      {profile?.hidden && (
        <p className="pf-warn" role="status">
          <TriangleAlert aria-hidden="true" />
          Your profile and everything you shared is currently not in the Community. {hiddenText(profile.hidden)}
        </p>
      )}

      <section className="pf-kpis" aria-label="Overview">
        <article className="pf-kpi">
          <span className="pf-kpi__label"><Coins aria-hidden="true" /> Balance</span>
          <strong className="pf-kpi__value">{available === null ? "–" : fmt(available)}</strong>
          <span className="pf-kpi__sub">
            {reserved > 0 ? `${fmt(reserved)} reserved right now` : statement?.expiring ? `${fmt(statement.expiring.credits)} plan Credits until ${DAY.format(statement.expiring.at)}` : "Credits"}
          </span>
          <Link href="/credits#top-up" className="pf-kpi__link">Top up <ArrowRight aria-hidden="true" /></Link>
        </article>
        <article className="pf-kpi">
          <span className="pf-kpi__label"><Activity aria-hidden="true" /> Usage, 30 days</span>
          <strong className="pf-kpi__value">{statement ? fmt(spent30) : "–"}</strong>
          <span className="pf-kpi__sub">{jobs30} {jobs30 === 1 ? "Job" : "Jobs"}</span>
          <span className="pf-spark" aria-hidden="true">
            {days.map((d) => <i key={d.start} style={{ "--h": d.credits / peak } as React.CSSProperties} data-zero={d.credits === 0 || undefined} />)}
          </span>
        </article>
        <article className="pf-kpi">
          <span className="pf-kpi__label"><Images aria-hidden="true" /> Creations</span>
          <strong className="pf-kpi__value">{loaded ? fmt(counts.all) : "–"}</strong>
          <span className="pf-kpi__sub">{counts.image} {counts.image === 1 ? "image" : "images"} · {counts.video} {counts.video === 1 ? "video" : "videos"}</span>
          <Link href="/assets" className="pf-kpi__link">Assets <ArrowRight aria-hidden="true" /></Link>
        </article>
        <article className="pf-kpi">
          <span className="pf-kpi__label"><Globe aria-hidden="true" /> In the Community</span>
          <strong className="pf-kpi__value">{community.loaded ? fmt(counts.public) : "–"}</strong>
          <span className="pf-kpi__sub">
            {community.stats && (counts.public || community.stats.followers)
              ? `${fmt(community.stats.likes)} ${community.stats.likes === 1 ? "Like" : "Likes"} · ${fmt(community.stats.followers)} ${community.stats.followers === 1 ? "follower" : "followers"}`
              : counts.public ? "public" : "Nothing shared yet"}
          </span>
          <Link href="/community" className="pf-kpi__link">Community <ArrowRight aria-hidden="true" /></Link>
        </article>
      </section>

      <div className="pf-grid">
        <section className="pf-panel" aria-labelledby="pf-usage">
          <header className="pf-panel__head">
            <h2 id="pf-usage">Usage</h2>
            <Link href="/credits" className="cm-btn cm-btn--quiet cm-btn--sm">Statement <ArrowRight aria-hidden="true" /></Link>
          </header>
          {statement ? <CreditMeter summary={statement.summary} /> : <p className="cm-note">Loading usage …</p>}
          <div className="pf-usage">
            <div>
              <h3 className="pf-label">By model</h3>
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
                <p className="cm-note">Once a job is charged, you'll see here what each model costs.</p>
              )}
            </div>
            <div>
              <h3 className="pf-label">By channel</h3>
              {usage.origins.length ? (
                <ul className="pf-rows">
                  {usage.origins.map((o) => (
                    <li key={o.origin}><span>{ORIGIN_LABEL[o.origin]}</span><span className="pf-dim">{o.jobs} {o.jobs === 1 ? "job" : "jobs"}</span><strong>{fmt(o.credits)}</strong></li>
                  ))}
                  {usage.director.messages > 0 && (
                    <li><span>Director</span><span className="pf-dim">{usage.director.messages} {usage.director.messages === 1 ? "message" : "messages"}</span><strong>{fmt(usage.director.credits)}</strong></li>
                  )}
                </ul>
              ) : (
                <p className="cm-note">Studio, MCP, CLI and API: this shows where you spend Credits.</p>
              )}
            </div>
          </div>
        </section>

        <section className="pf-panel" aria-labelledby="pf-account">
          <header className="pf-panel__head"><h2 id="pf-account">Account</h2></header>
          <dl className="pf-facts">
            <div><dt>Email</dt><dd>{me?.email ?? "–"}</dd></div>
            <div><dt>Plan</dt><dd>{plan ? `${fmt(plan.credits)} Credits per month` : "No plan"}</dd></div>
            <div><dt>Community</dt><dd>{profile ? `@${profile.handle}` : "No profile"}</dd></div>
            <div><dt>Prompts</dt><dd>{profile ? (profile.showPrompts ? "shown" : "private") : "–"}</dd></div>
          </dl>
          <nav className="pf-links" aria-label="Account">
            <Link href="/credits"><Receipt aria-hidden="true" /> Credits and statement <ChevronRight aria-hidden="true" /></Link>
            <Link href="/settings/api"><KeyRound aria-hidden="true" /> API &amp; MCP <ChevronRight aria-hidden="true" /></Link>
          </nav>
        </section>
      </div>

      <section className="pf-works" id="creations" aria-labelledby="pf-works-title">
        <div className="pf-works__head">
          <h2 id="pf-works-title">Creations</h2>
          <p>Open an image or video and tap “Share” to show it to everyone in the Community. Under “Public” you can show the prompt or make it private again. Everything else stays private.</p>
        </div>
        <div className="cm-bar">
          <div className="cm-tabs" role="tablist" aria-label="Visibility">
            {SHOW.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={show === s.id} className="cm-tab" onClick={() => { setShow(s.id); setLimit(PAGE); }}>
                {s.label}<span className="cm-tab__n">{counts[s.id]}</span>
              </button>
            ))}
          </div>
          <div className="cm-tabs" role="tablist" aria-label="Type">
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
            {hidden.length === 1 ? "One creation is" : `${hidden.length} creations are`} not in the Community: {hiddenText(mine.get(hidden[0]!.id)?.reason)}
          </p>
        )}

        {page.length ? (
          <>
            <Columns items={page} ratio={jobHeight} keyOf={(j) => j.id} min={240} dense>
              {(j, i) => <JobCard job={j} onOpen={() => setOpen(i)} />}
            </Columns>
            {shown.length > page.length && (
              <div className="cm-more">
                <button type="button" className="cm-btn" onClick={() => setLimit((l) => l + PAGE)}>Show more ({shown.length - page.length})</button>
              </div>
            )}
          </>
        ) : loaded ? (
          <div className="cm-empty">
            <FolderOpen aria-hidden="true" />
            <strong>{done.length ? (show === "public" ? "Nothing shared yet" : "Nothing in this selection") : "No creations yet"}</strong>
            <p>
              {done.length
                ? show === "public" ? "Open an image or video and tap “Share”, then it shows up here and in the Community." : "Choose a different selection."
                : "Your images and videos land here once they're done."}
            </p>
            {!done.length && <p className="pf-links-inline"><Link href="/image">Create an image</Link> · <Link href="/video">Create a video</Link></p>}
          </div>
        ) : null}
      </section>

      {open !== null && <Lightbox jobs={page} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
      {edit && <ProfileDialog onClose={() => setEdit(false)} />}
    </div>
  );
}
