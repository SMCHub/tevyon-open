import { describe, expect, it } from "vitest";
import type { Creation } from "@/core/community";
import { creationEntry, takeHref, visibilityOf } from "./community-view";

const base: Creation = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "image",
  jobType: "flux_3_image",
  model: "Seedream 4.5",
  media: { url: "/api/media/10000000-0000-4000-8000-000000000001/0.png", contentType: "image/png" },
  aspect: "16:9",
  prompt: "Ein Leuchtturm im Nebel & «Morgenlicht»",
  creator: { handle: "lena", name: "Lena Muster", avatar: null },
  publishedAt: 1,
  likes: 0,
};

describe("community view", () => {
  it("takes a prompt over into the creation's own studio with model and format", () => {
    const url = new URL(takeHref(base)!, "http://x");
    expect(url.pathname).toBe("/image");
    expect(Object.fromEntries(url.searchParams)).toEqual({ model: "flux_3_image", prompt: "Ein Leuchtturm im Nebel & «Morgenlicht»", aspect: "16:9" });
    expect(takeHref({ ...base, kind: "video", jobType: "veo_3_1_lite", aspect: undefined })).toMatch(/^\/video\?model=veo_3_1_lite&prompt=/);
    expect(takeHref({ ...base, prompt: null })).toBeNull();
  });

  it("shows a creation large as made with AI, with its creator and what to do next", () => {
    expect(creationEntry({ ...base, duration: undefined })).toMatchObject({
      chip: "Community",
      title: "Seedream 4.5",
      text: "Von Lena Muster (@lena)",
      prompt: base.prompt,
      facts: ["16:9", "KI-generiert"],
      action: { label: "Prompt übernehmen", href: takeHref(base) },
    });
    const preset = creationEntry({ ...base, kind: "video", prompt: null, duration: 4, audio: true, preset: { id: "say-it", title: "Sag es!", wish: "Hallo" } });
    expect(preset).toMatchObject({ text: "Von Lena Muster (@lena) · Preset Sag es!: Hallo", facts: ["16:9", "4 s", "Mit Ton", "KI-generiert"], audio: true });
    // Presets of older versions have no page any more: nothing to take over.
    expect(preset.action).toBeUndefined();
    expect(preset.prompt).toBeUndefined();
    expect(creationEntry({ ...base, resolution: "768" }).facts).toEqual(["16:9", "768 px", "KI-generiert"]);
    expect(creationEntry({ ...base, resolution: "2K" }).facts).toEqual(["16:9", "2K", "KI-generiert"]);
    // Marketing Agent styles are no preset page of their own.
    expect(creationEntry({ ...base, prompt: null, preset: { id: "ms:splash", title: "Marketing Agent · Splash" } }).action).toBeUndefined();
  });

  it("tells whether an own result is private, public or hidden by moderation", () => {
    const mine = new Map([
      ["a", { jobId: "a", state: "public" as const, showPrompt: true, publishedAt: 5 }],
      ["b", { jobId: "b", state: "hidden" as const, showPrompt: true, publishedAt: null, reason: "reports" }],
    ]);
    expect(visibilityOf(mine, "a")).toBe("public");
    expect(visibilityOf(mine, "b")).toBe("hidden");
    expect(visibilityOf(mine, "c")).toBe("private");
  });
});
