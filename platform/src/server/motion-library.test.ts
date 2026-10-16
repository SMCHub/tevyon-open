import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkUpload } from "@/core/uploads";
import { motionLibrary } from "./motion-library";

const PUBLIC = path.join(import.meta.dirname, "../../public");

describe("motion library templates", () => {
  const templates = motionLibrary();

  it("has unique ids (the library may be empty until new templates exist)", () => {
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
  });

  it.skipIf(templates.length === 0).each(templates.map((t) => [t.id, t] as const))("%s: files exist, its length is the file's, a recast job can take it", (_id, t) => {
    for (const url of [t.media.video, t.media.preview, t.media.poster]) expect(existsSync(path.join(PUBLIC, url)), url).toBe(true);
    const check = checkUpload(new Uint8Array(readFileSync(path.join(PUBLIC, t.media.video))));
    expect(check).toMatchObject({ ok: true, contentType: "video/mp4", suffix: `_${t.seconds}s` });
    expect(t.seconds).toBeGreaterThanOrEqual(4);
    expect(t.seconds).toBeLessThanOrEqual(30);
  });

  it.skipIf(templates.length === 0).each(templates.map((t) => [t.id, t] as const))("%s: the prompt names the video and no image the template does not ask for", (_id, t) => {
    expect(t.prompt).toMatch(/@Video 1/);
    const named = [...t.prompt.matchAll(/@Image (\d+)/g)].map((m) => Number(m[1]));
    expect(named.length).toBeGreaterThan(0);
    expect(Math.max(...named)).toBeLessThanOrEqual(t.images);
  });
});
