import type { ReactNode } from "react";
import type { Job } from "./studio-context";

/** What the preview plays. `audio`: known to have sound (true) or not (false); left out, the file itself tells. */
export type PreviewMedia = { url: string; kind: "image" | "video"; poster?: string; audio?: boolean };

/** The main step a preview offers: a page to go to or something to run, closing the preview either way. */
export type PreviewAction = { label: string; href?: string; run?: () => void; credits?: number | null; disabled?: boolean };

/**
 * One result, example or upload in the preview, with what its side panel shows. `extra`: further buttons
 * beside the main action (a public creation: like, the creator's page, "Report").
 */
export type PreviewEntry = PreviewMedia & {
  chip: string; title: string; text?: string; prompt?: string; facts?: string[]; action?: PreviewAction; extra?: ReactNode;
};

/** The result of a finished job, with its sound as far as its settings tell it; null while there is none. */
export function jobMedia(job: Job): PreviewMedia | null {
  const out = job.outputs[0];
  if (job.status !== "succeeded" || !out) return null;
  if (!out.contentType.startsWith("video/")) return { url: out.url, kind: "image" };
  const audio = job.params.generate_audio;
  return { url: out.url, kind: "video", ...(typeof audio === "boolean" ? { audio } : {}) };
}

/** The index one step away, or null past either end (the preview does not wrap around). */
export function step(index: number, delta: number, count: number): number | null {
  const next = index + delta;
  return next >= 0 && next < count ? next : null;
}

/** What a playing <video> tells about its sound, per browser (all of it non-standard). */
export type SoundProbe = {
  audioTracks?: { length: number };
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
  muted: boolean;
  currentTime: number;
};

/**
 * Whether the file has sound: Safari lists its audio tracks, Firefox says it outright, Chrome only counts decoded
 * audio bytes, so a clip there counts as silent after a second of unmuted playback without any. null: not known yet.
 */
export function soundOf(v: SoundProbe): boolean | null {
  if (v.audioTracks) return v.audioTracks.length > 0;
  if (typeof v.mozHasAudio === "boolean") return v.mozHasAudio;
  if (typeof v.webkitAudioDecodedByteCount !== "number") return null;
  if (v.webkitAudioDecodedByteCount > 0) return true;
  return !v.muted && v.currentTime >= 1 ? false : null;
}

export type SoundPrefs = { muted: boolean; volume: number };

/** The viewer's last volume and mute choice (stored as JSON), repaired to sane values; sound on by default. */
export function readPrefs(raw: string | null): SoundPrefs {
  let saved: { muted?: unknown; volume?: unknown } = {};
  try {
    saved = JSON.parse(raw ?? "{}") ?? {};
  } catch {}
  const volume = typeof saved.volume === "number" && Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 1;
  return { muted: saved.muted === true, volume };
}
