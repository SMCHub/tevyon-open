import type { Creation, OwnPublication } from "@/core/community";
import type { PreviewEntry } from "./preview";
import { ratio } from "./schema";

/** Where an own result stands: private, public, or hidden by moderation. */
export function visibilityOf(mine: ReadonlyMap<string, OwnPublication>, jobId: string): "private" | "public" | "hidden" {
  const p = mine.get(jobId);
  if (p?.state === "hidden") return "hidden";
  return p?.publishedAt != null ? "public" : "private";
}

/** “Use prompt”: the creation's own studio with its model, prompt and format set (draft.tsx reads them). */
export function takeHref(c: Creation): string | null {
  if (!c.prompt) return null;
  const q = new URLSearchParams({ model: c.jobType, prompt: c.prompt, ...(c.aspect ? { aspect: c.aspect } : {}) });
  return `/${c.kind}?${q.toString()}`;
}

/** Height / width of a tile before its media has loaded. */
export const creationHeight = (c: Creation) => 1 / ratio(c.aspect ?? (c.kind === "video" ? "16:9" : "1:1"));

/** A public creation in the shared preview: always marked as made with AI (AI Act Art. 50), with its creator. */
export function creationEntry(c: Creation): PreviewEntry {
  const take = takeHref(c);
  const marketing = c.preset?.id.startsWith("ms:") ?? false;
  // A bare number is a pixel size (FLUX “768”); named sizes (“2K”, “720p”) stay as they are.
  const size = c.resolution && /^\d+$/.test(c.resolution) ? `${c.resolution} px` : c.resolution;
  const facts = [c.aspect, c.duration ? `${c.duration} s` : null, size, c.audio ? "With audio" : null, "AI-generated"].filter((f): f is string => Boolean(f));
  const preset = c.preset ? ` · ${marketing ? "" : "Preset "}${c.preset.title}${c.preset.wish ? `: ${c.preset.wish}` : ""}` : "";
  return {
    url: c.media.url,
    kind: c.kind,
    ...(typeof c.audio === "boolean" ? { audio: c.audio } : {}),
    chip: "Community",
    title: c.model,
    text: `By ${c.creator.name} (@${c.creator.handle})${preset}`,
    ...(c.prompt ? { prompt: c.prompt } : {}),
    facts,
    ...(take ? { action: { label: "Use prompt", href: take } } : {}),
  };
}

/** What the owner reads about a creation that moderation took out of the community. */
export function hiddenText(reason: string | undefined): string {
  return !reason || reason === "reports" ? "Hidden after reports, under review." : `Hidden: ${reason}`;
}

/** The first letter of a name, for the round avatar. */
export const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? "?";

export const PROFILE_ERROR: Record<string, string> = {
  invalid_handle: "A handle has 3 to 20 characters: lowercase letters, digits and _, with at least one letter.",
  reserved_handle: "This handle isn't available. Choose another one.",
  handle_taken: "This handle is already taken.",
  invalid_name: "A name has 1 to 40 characters.",
  reserved_name: "The name must not sound like Tevyon.",
  invalid_bio: "“About you” has at most 160 characters.",
  terms_required: "Please accept the Community rules.",
  studio_only: "The profile can only be changed in the Studio.",
  storage_unavailable: "The Community can't be reached right now. Please try again in a moment.",
};

export const PUBLISH_ERROR: Record<string, string> = {
  not_ready: "Only finished results can be shared.",
  not_found: "This result no longer exists.",
  hidden: "Hidden after reports. We're reviewing it; until then it stays private.",
  storage_unavailable: "The Community can't be reached right now. Please try again in a moment.",
};
