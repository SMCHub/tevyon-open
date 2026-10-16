"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Share2, Users } from "lucide-react";
import type { FeedPage } from "@/core/community";
import { useCommunity } from "@/components/studio/community";
import { CommunityWall, FILTERS, ORDERS, useFeed, type Filter, type Order } from "@/components/studio/community-wall";
import { useStudio } from "@/components/studio/studio-context";
import { WallTitle } from "@/components/studio/wall";

/**
 * The community: what accounts published from their profile, newest first or most liked, or only from the creators
 * the viewer follows. Open to everyone; everything here is made with AI (the page says so, each preview marks it).
 */
export function CommunityPage({ initial }: { initial: FeedPage | null }) {
  const { guest } = useStudio();
  const { profile } = useCommunity();
  const [filter, setFilter] = useState<Filter>("all");
  const [order, setOrder] = useState<Order>("new");
  const feed = useFeed("/api/community", filter, order, initial);
  const kind = filter === "image" ? "Bilder" : filter === "video" ? "Videos" : null;
  const orders = guest ? ORDERS.filter((o) => o.id !== "following") : ORDERS;

  const tab = (on: boolean) => `chip${on ? " is-on" : ""}`;

  return (
    <div className="studio cm cm-feed wall-page">
      <WallTitle words={["Die", "Community"]} />

      {/* One quiet bar like the image studio: order and kind as plain tabs, the AI note and the actions on the right. */}
      <header className="wall-head cm-feedbar">
        <div className="cm-feedbar__filters">
          <div className="wall-tabs" role="tablist" aria-label="Reihenfolge">
            {orders.map((o) => (
              <button key={o.id} type="button" role="tab" aria-selected={order === o.id} className={tab(order === o.id)} onClick={() => setOrder(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
          <span className="cm-feedbar__sep" aria-hidden="true" />
          <div className="wall-tabs" role="tablist" aria-label="Art">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={tab(filter === f.id)} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="cm-feedbar__end">
          {/* Everything here is made with AI (AI Act Art. 50): said once, quietly. */}
          <p className="cm-feedbar__note">Mit KI erstellt · freigegeben von ihren Urhebern</p>
          {guest ? (
            <Link href="/login?next=%2Fcommunity" className="cm-link">Gratis starten <ArrowRight aria-hidden="true" /></Link>
          ) : (
            <>
              <Link href="/profile#kreationen" className="cm-link"><Share2 aria-hidden="true" /> Teilen</Link>
              {profile && <Link href={`/profile/${profile.handle}`} className="cm-link">Mein Profil</Link>}
            </>
          )}
        </div>
      </header>

      <section className="wall-body" aria-label="Kreationen der Community">
        <CommunityWall
          feed={feed}
          ownHandle={profile?.handle ?? null}
          guest={guest}
          empty={
            order === "following" ? (
              <div className="cm-empty">
                <Users aria-hidden="true" />
                <strong>Hier erscheint, was die Menschen teilen, denen du folgst</strong>
                <p>Öffne ein Profil in der Community und tippe auf «Folgen».</p>
                <button type="button" className="cm-btn" onClick={() => setOrder("new")}>Alle zeigen</button>
              </div>
            ) : (
              <div className="cm-empty">
                <Users aria-hidden="true" />
                <strong>{kind ? `Noch keine ${kind} in der Community` : "Noch nichts geteilt"}</strong>
                <p>Teile die erste Kreation: Öffne sie in deinem Profil gross und tippe auf «Teilen».</p>
                <Link href={guest ? "/login?next=%2Fprofile" : "/profile#kreationen"} className="cm-btn">Zum Profil <ArrowRight aria-hidden="true" /></Link>
              </div>
            )
          }
        />
      </section>
    </div>
  );
}
