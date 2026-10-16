import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryMediaStore } from "./media";
import { recreateFromLibrary, type LibraryPreset } from "./motion-library";

describe("motion library: recreate a template", () => {
  const ACC = "00000000-0000-4000-8000-000000000001";
  const preset: LibraryPreset = {
    id: "dance-1", title: "Dance", description: "", mode: "motion", prompt: "@Image 1 dances like @Video 1.", images: 2,
    resolution: "720p", seconds: 7, width: 720, height: 1280, categories: { curated: 0 },
    media: { video: "/api/media/library/motion/dance-1/source.mp4", preview: "", poster: "" },
  };
  const MP4 = new Uint8Array(readFileSync(path.join(import.meta.dirname, "testing/fixtures/video/sample-6.5s.mp4")));

  it("copies the driving video into the caller's uploads, named by its real length, and hands back mode and prompt", async () => {
    const media = createMemoryMediaStore("/api/media");
    const res = await recreateFromLibrary({ presets: [preset], read: async () => MP4, media }, ACC, preset.id);
    expect(res).toMatchObject({ ok: true, mode: "motion", prompt: preset.prompt, resolution: "720p", images: 2 });
    expect(res.ok && res.video).toMatch(new RegExp(`^/api/media/uploads/${ACC}/[0-9a-f-]{36}-64x64_7s(\\.mp4)?$`));
  });

  it("knows no template or file it cannot read", async () => {
    const media = createMemoryMediaStore("/api/media");
    expect(await recreateFromLibrary({ presets: [preset], read: async () => MP4, media }, ACC, "nope")).toEqual({ ok: false, error: "not_found" });
    expect(await recreateFromLibrary({ presets: [preset], read: async () => undefined, media }, ACC, preset.id)).toEqual({ ok: false, error: "not_found" });
  });
});
