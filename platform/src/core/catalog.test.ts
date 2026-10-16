import { describe, expect, it } from "vitest";
import { assetLink, catalog, inlineBase64, inlineData, rawBase64 } from "./catalog";
import { SAMPLE_UPLOAD, offeredOptions, paramSpace, sampleVideo, standardParams } from "./param-space";

describe("catalog", () => {
  it("offers the first wave of Comfy models", () => {
    expect(catalog.list().map((d) => d.jobType)).toEqual([
      "flux_3_image", "seedream_4_5", "seedream_5_0_pro", "seedream_5_0_flash", "gpt_image_2_5_sunburst", "gpt_image_2_5_flare",
      "nano_banana_pro", "nano_banana_2", "qwen_image_3_pro", "grok_imagine_image_2_0", "flux_2_pro", "flux_2_max", "minimax_h3", "ltx_2_5_fast", "kling_3_turbo", "kling_3_std", "kling_3_0_pro", "veo_3_1_lite", "seedance_2_5", "veo_3_1", "veo_3_1_fast",
      "kling_o1", "wan_3_0", "wan_3_0_prime", "grok_imagine_1_5", "grok_imagine_1_5_lite", "flux_3_video", "seedance_2_0",
      "wan_2_7", "happyhorse_1_1", "recast",
      "cutout", "upscale", "relight", "replace_background", "video_upscale", "video_edit",
    ]);
  });

  it("gives every job type a prompt, a public name and a router id of the form provider/model", () => {
    for (const def of catalog.list()) {
      expect(def.params.safeParse({}).success, def.jobType).toBe(false); // the prompt is required
      expect(standardParams(def).prompt, def.jobType).toBe(def.sample?.prompt ?? "x");
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

  // The router's price is passed on as it is: where it bills two resolutions alike (Seedream 4.5 2K and 4K), so do we.
  it("never charges less for a higher resolution", () => {
    for (const def of catalog.list()) {
      const values = offeredOptions(def).resolution;
      if (!values || values.length < 2) continue;
      const prices = values.map((resolution) => def.credits(def.params.parse({ ...standardParams(def), resolution })));
      for (let i = 1; i < prices.length; i++) expect(prices[i], `${def.jobType} ${String(values[i])}`).toBeGreaterThanOrEqual(prices[i - 1]!);
    }
  });

  it("takes only PNG and JPEG frames where the model refuses WebP (Veo, Kling)", () => {
    const webp = "/api/media/uploads/00000000-0000-4000-8000-000000000000/a.webp";
    const jpg = "/api/media/uploads/00000000-0000-4000-8000-000000000000/a.jpg";
    for (const t of ["veo_3_1_lite", "kling_3_std", "kling_3_0_pro"]) {
      const def = catalog.get(t)!;
      expect(def.params.safeParse({ prompt: "x", image: webp }).success, t).toBe(false);
      expect(def.params.safeParse({ prompt: "x", image: jpg }).success, t).toBe(true);
    }
  });

  it("prices Kling 3.0 per second by mode and sound, and sends frames as bare base64", () => {
    const std = catalog.get("kling_3_std")!;
    const pro = catalog.get("kling_3_0_pro")!;
    // 3 s silent at 720p: 3 × 17.72 = 53.16 → 54; 15 s with sound at 1080p: 15 × 29.54 = 443.1 → 444.
    expect(std.credits(std.params.parse({ prompt: "x", duration: 3, generate_audio: false }))).toBe(54);
    expect(std.credits(std.params.parse({ prompt: "x", duration: 15, generate_audio: true }))).toBe(355);
    expect(pro.credits(pro.params.parse({ prompt: "x", duration: 3, generate_audio: false }))).toBe(71);
    expect(pro.credits(pro.params.parse({ prompt: "x", duration: 15, generate_audio: true }))).toBe(444);

    expect(std.vendorParams!(std.params.parse({ prompt: "a fox", duration: 7 }))).toEqual({
      prompt: "a fox", mode: "std", duration: "7", sound: "off", aspect_ratio: "16:9",
    });
    const end = "/api/media/uploads/00000000-0000-4000-8000-000000000000/end.png";
    expect(pro.vendorParams!(pro.params.parse({ prompt: "a fox", image: SAMPLE_UPLOAD, end_image: end }))).toEqual({
      prompt: "a fox", mode: "pro", duration: "5", sound: "on",
      image_list: [{ image_url: rawBase64(SAMPLE_UPLOAD), type: "first_frame" }, { image_url: rawBase64(end), type: "end_frame" }],
    });
    expect(pro.params.safeParse({ prompt: "x", end_image: end }).success).toBe(false);
  });

  // Cheapest and dearest setting of each image model, from docs.comfy.org pricing (16.10.2026), rounded up.
  // Token-billed models (GPT Image, Nano Banana) are priced at the documented estimate.
  const ten = (n: number) => Array(n).fill(SAMPLE_UPLOAD);
  it.each([
    ["seedream_5_0_pro", { resolution: "1K" }, 10, { resolution: "2K", references: ten(10) }, 26], // 9.50; 18.99 + 10 × 0.63
    ["seedream_5_0_flash", {}, 6, { references: ten(10) }, 12], // 5.43; 5.43 + 10 × 0.63
    ["gpt_image_2_5_sunburst", { quality: "low", aspect_ratio: "16:9" }, 3, { quality: "max", references: ten(10) }, 103], // 1.41 + 1.51; 63.57 + 1.51 + 10 × 3.71
    ["gpt_image_2_5_flare", { quality: "low", aspect_ratio: "16:9" }, 3, { quality: "max", references: ten(10) }, 103],
    ["nano_banana_pro", { resolution: "1K" }, 34, { resolution: "4K", references: ten(14) }, 69], // 33.93; 60.77 + 14 × 0.567
    ["nano_banana_2", { resolution: "1K" }, 18, { resolution: "4K", references: ten(14) }, 41], // 17.62; 38.99 + 14 × 0.142
    ["qwen_image_3_pro", {}, 13, { resolution: "2K", references: ten(3) }, 26], // 12.07; 22.63 + 3 × 0.91
    ["grok_imagine_image_2_0", { quality: "low" }, 9, { resolution: "2K" }, 17], // 8.44; 16.88
    ["flux_2_pro", {}, 7, { resolution: "2K", references: ten(8) }, 42], // 6.33; 6.33 + 3.17 × (3 + 8)
    ["flux_2_max", {}, 15, { resolution: "2K", references: ten(8) }, 85], // 14.77; 14.77 + 6.33 × (3 + 8)
  ] as const)("prices %s from its cheapest to its dearest setting", (t, low, lowCredits, high, highCredits) => {
    const def = catalog.get(t)!;
    const prices = paramSpace(def).map((p) => def.credits(p));
    expect(def.credits(def.params.parse({ prompt: "x", ...low }))).toBe(lowCredits);
    expect(def.credits(def.params.parse({ prompt: "x", ...high }))).toBe(highCredits);
    expect([Math.min(...prices), Math.max(...prices)]).toEqual([lowCredits, highCredits]);
  });

  it.each([
    ["veo_3_1", { duration: 4, generate_audio: false }, 169, { duration: 8, resolution: "4K" }, 1013], // 4 × 42.2; 8 × 126.6
    ["veo_3_1_fast", { duration: 4, generate_audio: false }, 68, { duration: 8, resolution: "4K" }, 507], // 4 × 16.88; 8 × 63.3
    ["kling_o1", {}, 89, { duration: 10, resolution: "1080p" }, 237], // 5 × 17.72; 10 × 23.63
    ["wan_3_0", { duration: 2, resolution: "480p" }, 31, { duration: 30, resolution: "1080p" }, 1811], // 2 × 15.09; 30 × 60.35
    ["wan_3_0_prime", { duration: 2, resolution: "480p" }, 42, { duration: 30, resolution: "1080p" }, 2535], // 2 × 20.52; 30 × 84.48
    ["grok_imagine_1_5", { duration: 1, resolution: "480p" }, 25, { duration: 15, resolution: "1080p", image: SAMPLE_UPLOAD }, 1135], // 24.14; 15 × 75.43 + 3.02
    ["grok_imagine_1_5_lite", { duration: 1, resolution: "480p" }, 7, { duration: 15, image: SAMPLE_UPLOAD }, 139], // 6.03; 15 × 9.05 + 3.02
    ["flux_3_video", {}, 257, { duration: 20, resolution: "1080p" }, 1750], // 5 × 51.29; 20 × 87.5
    // Tokens: 4 s × 640 × 640 × 24 / 1024 = 38,400 × 2.112 / 1K; 15 s × 1440 × 1440 × 24 / 1024 = 729,000 × 2.323 / 1K.
    ["seedance_2_0", { duration: 4, resolution: "480p", aspect_ratio: "1:1" }, 82, { duration: 15, resolution: "1080p", aspect_ratio: "1:1" }, 1694],
    ["wan_2_7", { duration: 2 }, 43, { duration: 15, resolution: "1080p" }, 475], // 2 × 21.1; 15 × 31.65
    ["happyhorse_1_1", {}, 212, { duration: 15, resolution: "1080p" }, 815], // 5 × 42.24; 15 × 54.31
  ] as const)("prices the video model %s from its cheapest to its dearest setting", (t, low, lowCredits, high, highCredits) => {
    const def = catalog.get(t)!;
    const prices = paramSpace(def).map((p) => def.credits(p));
    expect(def.credits(def.params.parse({ prompt: "x", ...low }))).toBe(lowCredits);
    expect(def.credits(def.params.parse({ prompt: "x", ...high }))).toBe(highCredits);
    expect([Math.min(...prices), Math.max(...prices)]).toEqual([lowCredits, highCredits]);
  });

  it.each([
    ["cutout", {}, 4, {}, 4], // 3.8 per image
    ["upscale", { scale: "2x" }, 7, { scale: "4x" }, 7], // 6.03 for 2x and 4x alike
    ["relight", {}, 13, {}, 13], // 12.07
    ["replace_background", {}, 13, {}, 13], // 12.07
    // Per output megapixel and second, the rounded length plus half a second: 1.5× of a 4 s 720p clip is 1920 × 1080;
    // 3× creative of a 10 s clip is 3840 × 2160 = 8.29 MP × 30.17 × 10.5 s.
    ["video_upscale", { factor: "1.5", video: sampleVideo(4) }, 198, { factor: "3", creativity: "creative" }, 2628],
    ["video_edit", { video: sampleVideo(4) }, 41, {}, 96], // 9.05 × 4.5 s; 9.05 × 10.5 s
  ] as const)("prices the tool %s from its cheapest to its dearest setting", (t, low, lowCredits, high, highCredits) => {
    const def = catalog.get(t)!;
    const base = standardParams(def);
    const prices = paramSpace(def).map((p) => def.credits(p));
    expect(def.credits(def.params.parse({ ...base, ...low }))).toBe(lowCredits);
    expect(def.credits(def.params.parse({ ...base, ...high }))).toBe(highCredits);
    expect([Math.min(...prices), Math.max(...prices)]).toEqual([lowCredits, highCredits]);
  });

  it("sends the image tools' picture as an asset link and asks the video upscaler for precise by default", () => {
    const cut = catalog.get("cutout")!;
    expect(cut.vendorParams!(cut.params.parse({ image: SAMPLE_UPLOAD }))).toEqual({ image: assetLink(SAMPLE_UPLOAD), preserve_alpha: true });
    const up = catalog.get("video_upscale")!;
    expect(up.vendorParams!(up.params.parse({ video: sampleVideo(10) }))).toEqual({ input_video: sampleVideo(10), upscale_factor: 2, creativity: 0 });
    // A 1080p clip goes at most 2× (4K on the long side).
    const fhd = "/api/media/uploads/00000000-0000-4000-8000-000000000000/a-1920x1080_5s.mp4";
    expect(up.params.safeParse({ video: fhd, factor: "3" }).success).toBe(false);
    expect(up.params.safeParse({ video: fhd, factor: "2" }).success).toBe(true);
  });

  it("sends Wan 2.7 and HappyHorse to their text or image route, by whether a start frame comes along", () => {
    for (const [t, text, image] of [["wan_2_7", "wan/wan2.7-t2v", "wan/wan2.7-i2v"], ["happyhorse_1_1", "wan/happyhorse-1.1-t2v", "wan/happyhorse-1.1-i2v"]]) {
      const def = catalog.get(t!)!;
      expect(def.routeFor!(def.params.parse({ prompt: "x" }))).toBe(text);
      const withImage = def.params.parse({ prompt: "x", image: SAMPLE_UPLOAD });
      expect(def.routeFor!(withImage)).toBe(image);
      expect(def.vendorParams!(withImage)).toMatchObject({ input: { media: [{ type: "first_frame", url: SAMPLE_UPLOAD }] } });
      expect((def.vendorParams!(withImage) as { parameters: object }).parameters).not.toHaveProperty("ratio");
      expect(def.routes).toEqual([text, image]);
    }
  });

  it("offers Veo 3.1 above 720p only as 8 s clips, and sends start and end frame as bytes", () => {
    const def = catalog.get("veo_3_1")!;
    expect(def.params.safeParse({ prompt: "x", duration: 4, resolution: "1080p" }).success).toBe(false);
    const end = "/api/media/uploads/00000000-0000-4000-8000-000000000000/end.jpg";
    expect(def.vendorParams!(def.params.parse({ prompt: "x", image: SAMPLE_UPLOAD, end_image: end, resolution: "4K" }))).toEqual({
      instances: [{ prompt: "x", image: inlineBase64(SAMPLE_UPLOAD), lastFrame: inlineBase64(end) }],
      parameters: { durationSeconds: 8, aspectRatio: "16:9", resolution: "4k", generateAudio: true, sampleCount: 1 },
    });
  });

  it("sends Nano Banana's references as Gemini parts and FLUX.2's as bare base64 fields", () => {
    const nb = catalog.get("nano_banana_pro")!;
    expect(nb.vendorParams!(nb.params.parse({ prompt: "x", references: [SAMPLE_UPLOAD] }))).toEqual({
      contents: [{ role: "user", parts: [{ text: "x" }, inlineData(SAMPLE_UPLOAD)] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "2K" } },
      uploadImagesToStorage: true,
    });
    const flux = catalog.get("flux_2_pro")!;
    expect(flux.vendorParams!(flux.params.parse({ prompt: "x", aspect_ratio: "16:9", references: [SAMPLE_UPLOAD, SAMPLE_UPLOAD] }))).toEqual({
      prompt: "x", width: 1344, height: 768, output_format: "png", prompt_upsampling: false,
      input_image: rawBase64(SAMPLE_UPLOAD), input_image_2: rawBase64(SAMPLE_UPLOAD),
    });
  });

  it("prices Seedream 4.5 per image plus each reference, and sends a size instead of a format", () => {
    const def = catalog.get("seedream_4_5")!;
    expect(def.credits(def.params.parse({ prompt: "x" }))).toBe(9); // 8.44
    expect(def.credits(def.params.parse({ prompt: "x", resolution: "4K", references: Array(14).fill(SAMPLE_UPLOAD) }))).toBe(18); // 8.44 + 14 × 0.63 = 17.26
    expect(def.vendorParams!(def.params.parse({ prompt: "x", aspect_ratio: "16:9", references: [SAMPLE_UPLOAD] }))).toEqual({
      prompt: "x", size: "2848x1600", image: [SAMPLE_UPLOAD], sequential_image_generation: "disabled", response_format: "url", watermark: false,
    });
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

  it("prices Seedance 2.5 by its tokens, the Comfy docs' own example to the credit", () => {
    const def = catalog.get("seedance_2_5")!;
    // docs.comfy.org: 5 s, 16:9, 24 fps, 720p without a video input = 348.8 Comfy credits; 480p = 155.1.
    const p = def.params.parse({ prompt: "x" }) as Record<string, unknown>;
    expect(p).toMatchObject({ duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: true });
    expect(def.credits(p)).toBe(349);
    expect(def.credits({ ...p, resolution: "480p" })).toBe(156);
    const image = "/api/media/uploads/00000000-0000-4000-8000-000000000000/a.png";
    expect(def.vendorParams!({ ...p, image })).toEqual({
      content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: image }, role: "first_frame" }],
      resolution: "720p", ratio: "16:9", duration: 5, generate_audio: true, watermark: false,
    });
  });
});
