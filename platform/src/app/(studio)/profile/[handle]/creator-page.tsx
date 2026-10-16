"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Flag, Images, Pencil, UserCheck, UserPlus } from "lucide-react";
import type { FeedPage } from "@/core/community";
import { Avatar, ProfileDialog, ReportDialog, Toast, loginHere, setFollow, useCommunity } from "@/components/studio/community";
import { CommunityWall, FILTERS, useFeed, type CreatorHead, type Filter } from "@/components/studio/community-wall";
import { useStudio } from "@/components/studio/studio-context";

const SINCE = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

/**
 * What the community sees of a profile: picture, name, handle, bio, how much is public and how many follow, the public
 * creations. Others can follow or report it (without a login, both lead to the login first); its owner edits it here.
 */
export function CreatorPage({ handle, initial }: { handle: string; initial: CreatorHead & FeedPage }) {
  const router = useRouter();
  const { guest } = useStudio();
  const [filter, setFilter] = useState<Filter>("all");
  const feed = useFeed(`/api/community/${encodeURIComponent(handle)}`, filter, "new", initial);
  const { profile: own } = useCommunity();
  const [edit, setEdit] = useState(false);
  const [report, setReport] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const head = feed.head ?? initial;
  const mine = Boolean(own && own.handle === head.profile.handle);
  // Your own page shows your profile as you just saved it.
  const profile = mine && own ? { ...head.profile, name: own.name, bio: own.bio, avatar: own.avatar } : head.profile;
  const counts = head.counts;

  async function follow() {
    if (guest) return void (window.location.href = loginHere());
    setBusy(true);
    const on = !head.followed;
    const res = await setFollow(profile.handle, on);
    setBusy(false);
    if (res.ok) return feed.patchHead({ followed: res.following, followers: res.followers });
    if (res.error === "unauthorized") return void (window.location.href = loginHere());
    setNote("That couldn't be saved just now. Please try again.");
  }

  return (
    <div className="studio cm cm-page">
      <header className="cm-creator">
        <div className="cm-creator__who">
          <Avatar name={profile.name} src={profile.avatar} size="lg" />
          <div className="cm-creator__copy">
            <h1>{profile.name}</h1>
            <p className="cm-creator__line"><span>@{profile.handle}</span><span aria-hidden="true">·</span><span>Joined {SINCE.format(profile.since)}</span></p>
            {profile.bio && <p className="cm-creator__bio">{profile.bio}</p>}
          </div>
        </div>
        <div className="cm-creator__stats" aria-label="In the Community">
          <span className="cm-stat"><strong>{counts.image}</strong><span>{counts.image === 1 ? "Image" : "Images"}</span></span>
          <span className="cm-stat"><strong>{counts.video}</strong><span>{counts.video === 1 ? "Video" : "Videos"}</span></span>
          <span className="cm-stat"><strong>{head.followers}</strong><span>{head.followers === 1 ? "Follower" : "Followers"}</span></span>
        </div>
        <div className="cm-head__actions">
          {mine ? (
            <>
              <button type="button" className="cm-btn" onClick={() => setEdit(true)}><Pencil aria-hidden="true" /> Edit</button>
              <Link href="/profile#creations" className="cm-btn cm-btn--primary"><Images aria-hidden="true" /> Share</Link>
            </>
          ) : (
            <>
              <button type="button" className="cm-btn cm-btn--primary cm-follow" aria-pressed={Boolean(head.followed)} onClick={() => void follow()} disabled={busy}>
                {head.followed ? <><UserCheck aria-hidden="true" /> Following</> : <><UserPlus aria-hidden="true" /> Follow</>}
              </button>
              <button type="button" className="cm-btn cm-btn--quiet" onClick={() => (guest ? void (window.location.href = loginHere()) : setReport(true))}>
                <Flag aria-hidden="true" /> Report
              </button>
            </>
          )}
        </div>
      </header>

      <div className="cm-bar">
        <div className="cm-tabs" role="tablist" aria-label="Type">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="cm-tab" onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="cm-tab__n">{f.id === "all" ? counts.image + counts.video : counts[f.id]}</span>
            </button>
          ))}
        </div>
        <Link href="/community" className="cm-btn cm-btn--quiet cm-btn--sm"><ArrowLeft aria-hidden="true" /> Community</Link>
      </div>
      <CommunityWall
        feed={feed}
        showCreator={false}
        ownHandle={own?.handle ?? null}
        guest={guest}
        empty={
          <div className="cm-empty">
            <strong>{mine ? "You haven't shared anything yet" : `@${profile.handle} hasn't shared anything yet`}</strong>
            <p>{mine ? "Open an image or video in your profile and tap “Share”." : "Check back later."}</p>
            {mine && <Link href="/profile#creations" className="cm-btn">Go to profile</Link>}
          </div>
        }
      />

      {edit && (
        <ProfileDialog
          onClose={() => setEdit(false)}
          onSaved={(p) => {
            setEdit(false);
            // A new handle is a new address.
            if (p.handle !== profile.handle) router.replace(`/profile/${p.handle}`);
          }}
        />
      )}
      {report && (
        <ReportDialog
          target={{ kind: "profile", handle: profile.handle }}
          onClose={() => setReport(false)}
          onDone={(text) => {
            setReport(false);
            setNote(text);
          }}
        />
      )}
      {note && <Toast text={note} onDone={() => setNote(null)} />}
    </div>
  );
}
