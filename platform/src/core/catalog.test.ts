import { describe, expect, it } from "vitest";
import { catalog, inlineBase64 } from "./catalog";
import { SAMPLE_UPLOAD, offeredOptions, paramSpace, standardParams } from "./param-space";

describe("catalog", () => {
  it("offers the first wave of Comfy models", () => {
    expect(catalog.list().map((d) => d.jobType)).toEqual(["flux_3_image", "minimax_h3", "ltx_2_5_fast", "kling_3_turbo", "veo_3_1_lite", "recast"]);
  });

  it("gives every job type a prompt, a public name and a router id of the form provider/model", () => {
    for (const def of catalog.list()) {
      expect(def.params.safeParse({}).success, def.jobType).toBe(false); // the prompt is required
      expect(standardParams(def).prompt, def.jobType).toBe("x");
      expect(def.model.length, def.jobType).toBeGreaterThan(0);
      expect(def.route.provider, def.jobType).toBe("comfy");
      expect(def.route.providerModel, def.jobType).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
    }
  });

  it("prices the standard settings of every job type at a positive whole number of credits", () => {
    for (const def of catalog.list()) {
      const credits = def.credits(standardParams(def));
      expect(Number.isInteger(credits) && credits > 0, `${def.jobType}: ${credits}`).toBe(true);
    }
  });

  it("prices every parameter set it accepts, and never at 0", () => {
    for (const def of catalog.list()) {
      for (const p of paramSpace(def)) {
        const credits = def.credits(p);
        expect(Number.isInteger(credits) && credits > 0, `${def.jobType} ${JSON.stringify(p)}`).toBe(true);
      }
    }
  });

  it("prices from the router's list price: an 8 s Veo 3.1 Lite clip at 720p with sound", () => {
    // Worked example: 8 s × 10.55 Comfy credits per second = 84.4 → 85 credits (markup 1).
    const def = catalog.get("veo_3_1_lite")!;
    expect(def.credits(def.params.parse({ prompt: "a fox", duration: 8, resolution: "720p", generate_audio: true }))).toBe(85);
    expect(def.credits(def.params.parse({ prompt: "a fox", duration: 8, resolution: "720p", generate_audio: false }))).toBe(51);
  });

  it("charges more for every higher resolution", () => {
    for (const def of catalog.list()) {
      const values = offeredOptions(def).resolution;
      expect(values?.length, def.jobType).toBeGreaterThan(1);
      const prices = values!.map((resolution) => def.credits(def.params.parse({ ...standardParams(def), resolution })));
      for (let i = 1; i < prices.length; i++) expect(prices[i], `${def.jobType} ${String(values![i])}`).toBeGreaterThan(prices[i - 1]!);
    }
  });

  it("sends Veo's start image as a marker the provider fills with the file's bytes", () => {
    const def = catalog.get("veo_3_1_lite")!;
    const body = def.vendorParams!(def.params.parse({ prompt: "a fox", image: SAMPLE_UPLOAD }));
    expect(body).toMatchObject({ instances: [{ prompt: "a fox", image: inlineBase64(SAMPLE_UPLOAD) }] });
    expect(inlineBase64(SAMPLE_UPLOAD)).toEqual({ $inlineBase64: SAMPLE_UPLOAD });
  });

  it("accepts only our own uploads as input files", () => {
    const def = catalog.get("minimax_h3")!;
    expect(def.params.safeParse({ prompt: "x", image: "https://example.com/a.png" }).success).toBe(false);
    expect(def.params.safeParse({ prompt: "x", image: SAMPLE_UPLOAD }).success).toBe(true);
  });

  it("recasts a reference video: its motion and camera, a new scene, priced by the tokens of both clips", () => {
    const def = catalog.get("recast")!;
    const video = "/api/media/uploads/00000000-0000-4000-8000-000000000000/ref-1280x720_4s.mp4";
    const p = def.params.parse({ prompt: "a snowy mountain valley at night", video }) as Record<string, unknown>;
    // Seedance bills (input + output seconds) × width × height × 24 fps / 1024 tokens; with a video input 0.996 per 1K.
    // 480p 16:9 renders 864 × 496: (4 + 5) × 864 × 496 × 24 / 1024 = 90,396 tokens → 90.03 Comfy credits → 91.
    expect(def.credits(p)).toBe(91);
    expect(def.credits({ ...p, resolution: "720p" })).toBeGreaterThan(def.credits(p));
    expect(def.vendorParams!(p)).toEqual({
      content: [
        { type: "text", text: "a snowy mountain valley at night" },
        { type: "video_url", video_url: { url: video }, role: "reference_video" },
      ],
      resolution: "480p", ratio: "16:9", duration: 5, generate_audio: false, watermark: false,
    });
    expect(def.params.safeParse({ prompt: "x", video: "https://elsewhere.test/v.mp4" }).success).toBe(false);
  });
});
