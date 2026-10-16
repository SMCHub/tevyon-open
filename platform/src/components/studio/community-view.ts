import type { Creation, OwnPublication } from "@/core/community";
import type { PreviewEntry } from "./preview";
import { ratio } from "./schema";

/** Where an own result stands: private, public, or hidden by moderation. */
export function visibilityOf(mine: ReadonlyMap<string, OwnPublication>, jobId: string): "private" | "public" | "hidden" {
  const p = mine.get(jobId);
  if (p?.state === "hidden") return "hidden";
  return p?.publishedAt != null ? "public" : "private";
}

/** «Prompt übernehmen»: the creation's own studio with its model, prompt and format set (draft.tsx reads them). */
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
  // A bare number is a pixel size (FLUX «768»); named sizes («2K», «720p») stay as they are.
  const size = c.resolution && /^\d+$/.test(c.resolution) ? `${c.resolution} px` : c.resolution;
  const facts = [c.aspect, c.duration ? `${c.duration} s` : null, size, c.audio ? "Mit Ton" : null, "KI-generiert"].filter((f): f is string => Boolean(f));
  const preset = c.preset ? ` · ${marketing ? "" : "Preset "}${c.preset.title}${c.preset.wish ? `: ${c.preset.wish}` : ""}` : "";
  return {
    url: c.media.url,
    kind: c.kind,
    ...(typeof c.audio === "boolean" ? { audio: c.audio } : {}),
    chip: "Community",
    title: c.model,
    text: `Von ${c.creator.name} (@${c.creator.handle})${preset}`,
    ...(c.prompt ? { prompt: c.prompt } : {}),
    facts,
    ...(take ? { action: { label: "Prompt übernehmen", href: take } } : {}),
  };
}

/** What the owner reads about a creation that moderation took out of the community. */
export function hiddenText(reason: string | undefined): string {
  return !reason || reason === "reports" ? "Nach Meldungen ausgeblendet, wird geprüft." : `Ausgeblendet: ${reason}`;
}

/** The first letter of a name, for the round avatar. */
export const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? "?";

export const PROFILE_ERROR: Record<string, string> = {
  invalid_handle: "Der Handle hat 3 bis 20 Zeichen: Kleinbuchstaben, Ziffern und _, mit mindestens einem Buchstaben.",
  reserved_handle: "Diesen Handle vergeben wir nicht. Wähle einen anderen.",
  handle_taken: "Dieser Handle ist schon vergeben.",
  invalid_name: "Der Name hat 1 bis 40 Zeichen.",
  reserved_name: "Der Name darf nicht nach Tevyon klingen.",
  invalid_bio: "«Über dich» hat höchstens 160 Zeichen.",
  terms_required: "Bitte bestätige die Community-Regeln.",
  studio_only: "Das Profil lässt sich nur im Studio ändern.",
  storage_unavailable: "Die Community ist gerade nicht erreichbar. Versuch es gleich noch einmal.",
};

export const PUBLISH_ERROR: Record<string, string> = {
  not_ready: "Teilen lassen sich nur fertige Ergebnisse.",
  not_found: "Dieses Ergebnis gibt es nicht mehr.",
  hidden: "Nach Meldungen ausgeblendet. Wir prüfen es; so lange bleibt es privat.",
  storage_unavailable: "Die Community ist gerade nicht erreichbar. Versuch es gleich noch einmal.",
};
