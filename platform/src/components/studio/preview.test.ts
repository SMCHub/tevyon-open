import { describe, expect, it } from "vitest";
import type { PresetInfo } from "./presets-data";
import type { Job } from "./studio-context";
import { jobMedia, presetEntry, readPrefs, soundOf, step } from "./preview";

const job = (over: Partial<Job>): Job => ({
  id: "j1", jobType: "veo_3_1_lite", model: "Veo 3.1 Lite", status: "succeeded", credits: 45,
  outputs: [{ url: "/api/media/out/j1.mp4", contentType: "video/mp4" }], params: { prompt: "Leuchtturm im Sturm" }, createdAt: 0, ...over,
});

describe("preview of a job", () => {
  it("plays a finished video and knows its sound from the settings", () => {
    expect(jobMedia(job({ params: { prompt: "x", generate_audio: true } }))).toEqual({ url: "/api/media/out/j1.mp4", kind: "video", audio: true });
    expect(jobMedia(job({ params: { prompt: "x", generate_audio: false } }))?.audio).toBe(false);
    // Without the setting the file decides (models that always add sound).
    expect(jobMedia(job({}))?.audio).toBeUndefined();
  });

  it("shows a finished image, and nothing for a job without a result", () => {
    expect(jobMedia(job({ outputs: [{ url: "/api/media/out/j1.png", contentType: "image/png" }] }))).toEqual({ url: "/api/media/out/j1.png", kind: "image" });
    expect(jobMedia(job({ status: "running", outputs: [] }))).toBeNull();
    expect(jobMedia(job({ status: "failed", outputs: [] }))).toBeNull();
  });
});

describe("preview of a preset", () => {
  const preset: PresetInfo = {
    id: "say-it", title: "Say it!", tagline: "Your photo speaks your line", category: "viral", needs: "photo", badge: "top",
    preview: { video: "/presets/say-it.mp4", poster: "/presets/say-it.webp" }, wishHint: null, line: null, credits: 85,
  };

  it("opens a preset with its tagline and the way to try it at its price", () => {
    expect(presetEntry(preset)).toMatchObject({
      url: "/presets/say-it.mp4", kind: "video", poster: "/presets/say-it.webp", chip: "Preset", title: "Say it!", text: "Your photo speaks your line",
      action: { label: "Try it", href: "/presets/say-it", credits: 85 },
    });
  });
});

describe("paging", () => {
  it("moves within the list and stops at both ends", () => {
    expect(step(0, 1, 3)).toBe(1);
    expect(step(2, -1, 3)).toBe(1);
    expect(step(2, 1, 3)).toBeNull();
    expect(step(0, -1, 3)).toBeNull();
  });
});

describe("sound of the playing file", () => {
  it("trusts what Safari and Firefox report right away", () => {
    expect(soundOf({ audioTracks: { length: 1 }, muted: false, currentTime: 0 })).toBe(true);
    expect(soundOf({ audioTracks: { length: 0 }, muted: false, currentTime: 0 })).toBe(false);
    expect(soundOf({ mozHasAudio: false, muted: false, currentTime: 0 })).toBe(false);
  });

  it("decides in Chrome once a second has played with or without decoded sound", () => {
    expect(soundOf({ webkitAudioDecodedByteCount: 2048, muted: false, currentTime: 0.2 })).toBe(true);
    expect(soundOf({ webkitAudioDecodedByteCount: 0, muted: false, currentTime: 0.4 })).toBeNull();
    expect(soundOf({ webkitAudioDecodedByteCount: 0, muted: false, currentTime: 1.2 })).toBe(false);
  });

  it("never calls a muted clip silent: it may only be muted", () => {
    expect(soundOf({ webkitAudioDecodedByteCount: 0, muted: true, currentTime: 3 })).toBeNull();
  });

  it("cannot tell in other browsers", () => {
    expect(soundOf({ muted: false, currentTime: 5 })).toBeNull();
  });
});

describe("sound preferences", () => {
  it("start with sound at full volume", () => {
    expect(readPrefs(null)).toEqual({ muted: false, volume: 1 });
  });

  it("keep what the viewer chose and repair broken values", () => {
    expect(readPrefs('{"muted":true,"volume":0.4}')).toEqual({ muted: true, volume: 0.4 });
    expect(readPrefs('{"volume":7}')).toEqual({ muted: false, volume: 1 });
    expect(readPrefs('{"muted":"ja","volume":-2}')).toEqual({ muted: false, volume: 0 });
    expect(readPrefs("kaputt")).toEqual({ muted: false, volume: 1 });
  });
});
