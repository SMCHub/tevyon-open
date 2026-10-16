import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { currentAccount } from "@/server/account";
import { community, handleParam } from "@/server/community";
import { pageOrigin } from "@/server/consent";
import { CreatorPage } from "./creator-page";

/** One read per request for the metadata and the page (React cache), with the viewer's follows and likes. */
const load = cache(async (handle: string) => {
  const viewer = await currentAccount();
  return (await community()).creator(handleParam(handle), {}, viewer?.id).catch(() => null);
});

/** Public and indexable: name, description and the picture (or the first image) as the preview in social media. */
export async function generateMetadata({ params }: PageProps<"/profile/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const page = await load(handle);
  if (!page) return { title: "Profile not found – Tevyon", robots: { index: false, follow: false } };
  const { profile, counts } = page;
  const title = `${profile.name} (@${profile.handle}) – Tevyon`;
  const parts = [
    counts.image ? `${counts.image} ${counts.image === 1 ? "image" : "images"}` : null,
    counts.video ? `${counts.video} ${counts.video === 1 ? "video" : "videos"}` : null,
  ].filter(Boolean);
  const description =
    profile.bio || (parts.length ? `${parts.join(" and ")} by ${profile.name}, made with AI and shared on Tevyon.` : `${profile.name} on Tevyon: images and videos made with AI.`);
  const image = profile.avatar ?? page.items.find((c) => c.kind === "image")?.media.url;
  return {
    title,
    description,
    robots: { index: true, follow: true },
    metadataBase: new URL(await pageOrigin()),
    alternates: { canonical: `/profile/${profile.handle}` },
    openGraph: { type: "profile", title, description, url: `/profile/${profile.handle}`, ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: "summary", title, description },
  };
}

/** A creator's public page: what the community sees of a profile and its public creations. Unknown handles are a 404. */
export default async function Page({ params }: PageProps<"/profile/[handle]">) {
  const { handle } = await params;
  const page = await load(handle);
  if (!page) notFound();
  return <CreatorPage handle={page.profile.handle} initial={page} />;
}
