import type { Metadata } from "next";
import { currentAccount } from "@/server/account";
import { community } from "@/server/community";
import { pageOrigin } from "@/server/consent";
import { CommunityPage } from "./community-page";

const TITLE = "Community – Tevyon";
const DESCRIPTION = "Bilder und Videos, die Menschen mit Tevyon erstellt und geteilt haben. Alle mit KI erstellt, jeder Prompt zum Übernehmen.";

/** Public and indexable (the Studio around it is not): the first picture is the preview in social media. */
export async function generateMetadata(): Promise<Metadata> {
  const origin = await pageOrigin();
  const first = await firstPage().catch(() => null);
  const image = first?.items.find((c) => c.kind === "image")?.media.url;
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: { index: true, follow: true },
    metadataBase: new URL(origin),
    alternates: { canonical: "/community" },
    openGraph: { title: TITLE, description: DESCRIPTION, type: "website", url: "/community", ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title: TITLE, description: DESCRIPTION },
  };
}

async function firstPage(viewer?: string) {
  return (await community()).feed({}, viewer);
}

/**
 * The community, open to everyone: the first page renders on the server (for the first paint and search engines),
 * with the viewer's likes when signed in; the browser takes over from there.
 */
export default async function Page() {
  const viewer = await currentAccount();
  const initial = await firstPage(viewer?.id).catch(() => null);
  return <CommunityPage initial={initial} />;
}
