import { z } from "zod";
import { SAMPLE_UPLOAD, sampleVideo } from "./param-space";
import { creditsFromComfy } from "./pricing";
import { defineRegister, jobType, type Register } from "./register";

/**
 * The register of the open version: every job type runs on the Comfy Router (providers/comfy.ts), addressed by its
 * router id `{provider}/{model}`. Prices are the router's own, in Comfy credits per image or per second, as listed in
 * docs.comfy.org “Partner Nodes pricing” (checked 16.10.2026); pricing.ts turns them into credits. Adding a model is
 * one entry here plus a prompt skill in `skills/` that names its job type.
 */
const ROUTER = "comfy";

const prompt = z.string().trim().min(1).max(4000);
/** Our own uploads only: never a foreign URL (the server inlines them for the router). */
const OWN_IMAGE = /^\/api\/media\/uploads\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/;
const startImage = z.string().regex(OWN_IMAGE).optional();
/** Veo and Kling take only PNG and JPEG frames: a WebP upload is refused here, before it costs anything. */
const OWN_PNG_JPEG = /^\/api\/media\/uploads\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.(png|jpe?g)$/;
const frameImage = z.string().regex(OWN_PNG_JPEG, "PNG or JPEG only").optional();
const references = (max: number) => z.array(z.string().regex(OWN_IMAGE)).max(max).default([]);
/** A reference video: the caller's own upload; the server put its length in whole seconds into the name (uploads.ts). */
const OWN_VIDEO = /^\/api\/media\/uploads\/[0-9a-f-]{36}\/[A-Za-z0-9-]+_(\d{1,3})s\.mp4$/;
const videoSeconds = (url: string) => Number(OWN_VIDEO.exec(url)?.[1] ?? NaN);
/** A value the provider replaces with the file's bytes as `{ bytesBase64Encoded, mimeType }` (the Veo request shape). */
export const inlineBase64 = (url: string) => ({ $inlineBase64: url });
/** A value the provider replaces with the file's bare base64, without a data: prefix (FLUX.2, Kling). */
export const rawBase64 = (url: string) => ({ $rawBase64: url });
/** A value the provider replaces with Gemini's `{ inlineData: { mimeType, data } }` part. */
export const inlineData = (url: string) => ({ $inlineData: url });
/** A value the provider replaces with a signed link from Comfy's asset store (Bria takes links). */
export const assetLink = (url: string) => ({ $assetLink: url });
/** An end frame needs a start frame (no model here starts from an end frame alone). */
const endNeedsStart = (p: { image?: string; end_image?: string }) => !p.end_image || !!p.image;
const END_NEEDS_START = { message: "an end frame needs a start frame", path: ["end_image"] };

/** Comfy credits per image of FLUX 3 by resolution class. */
const FLUX_3_IMAGE = { "768sq": 12.37, "1k": 14.48, "1.5k": 21.12, "2k": 30.17, "4k": 183.15 } as const;
/** Comfy credits per second of video. */
const PER_SECOND = {
  minimaxH3: { "768P": 27.16, "2K": 39.22 },
  ltx25Fast: { "720p": 27.16, "1080p": 39.22 },
  kling30Turbo: { "720p": 23.63, "1080p": 29.54 },
  veo31Lite: { "720p": { silent: 6.33, audio: 10.55 }, "1080p": { silent: 10.55, audio: 16.88 } },
} as const;

/**
 * Seedance 2.0 Fast bills tokens: (input video seconds + output seconds) × width × height × 24 fps / 1024, at 0.996
 * Comfy credits per 1K tokens when a video goes in (docs.comfy.org pricing, 16.10.2026). Frame sizes as rendered.
 */
const SEEDANCE_FRAME = {
  "480p": { "16:9": [864, 496], "9:16": [496, 864], "1:1": [640, 640] },
  "720p": { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [960, 960] },
} as const;
const SEEDANCE_PER_1K_WITH_VIDEO = 0.996;
/**
 * Seedance 2.0 (full) without a video input, per 1K tokens: 2.112 up to 720p, 2.323 at 1080p (docs.comfy.org pricing,
 * 16.10.2026). 480p renders padded like 2.0 Fast; 1080p 1:1 is priced at the 1440² frame Seedance lists for 2.5, the
 * larger of the sizes in question.
 */
const SEEDANCE_20_FRAME = {
  ...SEEDANCE_FRAME,
  "1080p": { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1440, 1440] },
} as const;
const SEEDANCE_20_PER_1K = { "480p": 2.112, "720p": 2.112, "1080p": 2.323 } as const;
/** Seedance 2.5 renders the listed sizes; per 1K tokens without a video input (docs.comfy.org pricing, 16.10.2026). */
const SEEDANCE_25_FRAME = {
  "480p": { "16:9": [854, 480], "9:16": [480, 854], "1:1": [640, 640] },
  "720p": { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [960, 960] },
  "1080p": { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1440, 1440] },
} as const;
const SEEDANCE_25_PER_1K = { "480p": 3.229, "720p": 3.229, "1080p": 3.53 } as const;

/**
 * Seedream bills per image; the first image of a request is free and each further one, output or reference, adds 0.63
 * (docs.comfy.org pricing, 16.10.2026). With one output that is 0.63 per reference image.
 */
const SEEDREAM_PER_REFERENCE = 0.63;
/** Seedream 4.5 takes no aspect ratio, only a size: the 2K and 4K presets of the ComfyUI node (≥ 3,686,400 px). */
const SEEDREAM_45_SIZE = {
  "2K": { "1:1": "2048x2048", "3:4": "1728x2304", "4:3": "2304x1728", "16:9": "2848x1600", "9:16": "1600x2848", "2:3": "1664x2496", "3:2": "2496x1664", "21:9": "3136x1344" },
  "4K": { "1:1": "4096x4096", "3:4": "3520x4704", "4:3": "4704x3520", "16:9": "5504x3040", "9:16": "3040x5504", "2:3": "3328x4992", "3:2": "4992x3328", "21:9": "6240x2656" },
} as const;
const IMAGE_ASPECTS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] as const;

/** Kling 3.0 Omni per second: std renders 720p, pro 1080p; sound costs extra (docs.comfy.org pricing, 16.10.2026). */
const KLING_3_OMNI = { std: { silent: 17.72, audio: 23.63 }, pro: { silent: 23.63, audio: 29.54 } } as const;

/**
 * Kling 3.0 in standard (720p) or pro (1080p) mode. Both run on Kling 3.0 Omni, the one Kling 3.0 route on the router
 * that takes a start and end frame as well as text alone (kling-v3 there is text only), and is never dearer.
 * Kling wants frames as bare base64, PNG or JPEG.
 */
function kling3(def: { jobType: string; model: string; tagline: string; mode: "std" | "pro"; audio: boolean }) {
  return jobType({
    jobType: def.jobType,
    kind: "video",
    model: def.model,
    tagline: def.tagline,
    family: "kling",
    params: z.object({
      prompt: z.string().trim().min(1).max(2500),
      image: frameImage,
      end_image: frameImage,
      duration: z.number().int().min(3).max(15).default(5),
      aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
      generate_audio: z.boolean().default(def.audio),
    }).refine(endNeedsStart, END_NEEDS_START),
    credits: (p) => creditsFromComfy(KLING_3_OMNI[def.mode][p.generate_audio ? "audio" : "silent"] * p.duration),
    vendorParams: (p) => ({
      prompt: p.prompt,
      mode: def.mode,
      duration: String(p.duration),
      sound: p.generate_audio ? "on" : "off",
      // With a start frame the clip takes the frame's format.
      ...(p.image
        ? { image_list: [{ image_url: rawBase64(p.image), type: "first_frame" }, ...(p.end_image ? [{ image_url: rawBase64(p.end_image), type: "end_frame" }] : [])] }
        : { aspect_ratio: p.aspect_ratio }),
    }),
    route: { provider: ROUTER, providerModel: "kling/kling-v3-omni" },
  });
}

/**
 * Seedream 5.0 Pro takes 1,048,576 to 4,194,304 px (router schema): 1K and 2K sizes inside that range, exact ratios.
 * Billed 9.50 up to 2.61 MP and 18.99 above (docs.comfy.org pricing, 16.10.2026).
 */
const SEEDREAM_50_PRO_SIZE = {
  "1K": { "1:1": "1024x1024", "3:4": "888x1184", "4:3": "1184x888", "16:9": "1376x774", "9:16": "774x1376", "2:3": "840x1260", "3:2": "1260x840", "21:9": "1568x672" },
  "2K": { "1:1": "2048x2048", "3:4": "1770x2360", "4:3": "2360x1770", "16:9": "2720x1530", "9:16": "1530x2720", "2:3": "1672x2508", "3:2": "2508x1672", "21:9": "3080x1320" },
} as const;
const SEEDREAM_50_PRO = { "1K": 9.5, "2K": 18.99 } as const;
/** Seedream 5.0 Flash: the ComfyUI node's 1K and 2K presets (921,600 to 4,624,220 px); one price for every size. */
const SEEDREAM_50_FLASH_SIZE = {
  "1K": { "1:1": "1024x1024", "3:4": "864x1152", "4:3": "1152x864", "16:9": "1424x800", "9:16": "800x1424", "2:3": "832x1248", "3:2": "1248x832", "21:9": "1568x672" },
  "2K": { "1:1": "2048x2048", "3:4": "1776x2368", "4:3": "2368x1776", "16:9": "2816x1584", "9:16": "1584x2816", "2:3": "1664x2496", "3:2": "2496x1664", "21:9": "3136x1344" },
} as const;

/** Seedream 5.0 (Pro, Flash): a size, up to 10 references, PNG out, no watermark (default on). */
function seedream5(def: { jobType: string; model: string; tagline: string; providerModel: string; sizes: typeof SEEDREAM_50_PRO_SIZE | typeof SEEDREAM_50_FLASH_SIZE; price: (resolution: "1K" | "2K") => number }) {
  return jobType({
    jobType: def.jobType,
    kind: "image",
    model: def.model,
    tagline: def.tagline,
    family: "seedream",
    params: z.object({
      prompt,
      aspect_ratio: z.enum(IMAGE_ASPECTS).default("1:1"),
      resolution: z.enum(["1K", "2K"]).default("2K"),
      references: references(10),
    }),
    credits: (p) => creditsFromComfy(def.price(p.resolution) + SEEDREAM_PER_REFERENCE * p.references.length),
    vendorParams: (p) => ({
      prompt: p.prompt,
      size: def.sizes[p.resolution][p.aspect_ratio],
      ...(p.references.length ? { image: p.references } : {}),
      output_format: "png",
      response_format: "url",
      watermark: false,
    }),
    route: { provider: ROUTER, providerModel: def.providerModel },
  });
}

/**
 * GPT Image 2.5 bills tokens after the fact. The price before the start is the ComfyUI node's estimate per quality and
 * size (docs.comfy.org pricing and node badges, 16.10.2026), plus the longest prompt (about 1,000 tokens at 1508.65 per
 * 1M) and the dearest reference estimate (0.0176 USD = 3.71 per image). An estimate: the real bill may differ a little.
 */
const GPT_IMAGE_SIZE = { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024", "16:9": "2048x1152", "9:16": "1152x2048" } as const;
const GPT_IMAGE_25 = {
  low: { "1:1": 1.77, "2:3": 1.43, "3:2": 1.43, "16:9": 1.41, "9:16": 1.41 },
  medium: { "1:1": 3.97, "2:3": 3.1, "3:2": 3.1, "16:9": 3.31, "9:16": 3.31 },
  high: { "1:1": 15.89, "2:3": 12.43, "3:2": 12.43, "16:9": 12.79, "9:16": 12.79 },
  xhigh: { "1:1": 28.25, "2:3": 22.26, "3:2": 22.26, "16:9": 22.72, "9:16": 22.72 },
  max: { "1:1": 63.57, "2:3": 49.67, "3:2": 49.67, "16:9": 51.15, "9:16": 51.15 },
} as const;
const GPT_IMAGE_PROMPT = 1.51;
const GPT_IMAGE_PER_REFERENCE = 3.71;

function gptImage(def: { jobType: string; model: string; tagline: string; badge?: "neu" | "top"; providerModel: string }) {
  return jobType({
    jobType: def.jobType,
    kind: "image",
    model: def.model,
    tagline: def.tagline,
    ...(def.badge ? { badge: def.badge } : {}),
    family: "gpt-image",
    params: z.object({
      prompt,
      aspect_ratio: z.enum(["1:1", "2:3", "3:2", "16:9", "9:16"]).default("1:1"),
      quality: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
      references: references(10),
    }),
    credits: (p) => creditsFromComfy(GPT_IMAGE_25[p.quality][p.aspect_ratio] + GPT_IMAGE_PROMPT + GPT_IMAGE_PER_REFERENCE * p.references.length),
    // The quality goes explicitly: "auto" would leave the price open. With references the call becomes an edit.
    vendorParams: (p) => ({
      prompt: p.prompt,
      size: GPT_IMAGE_SIZE[p.aspect_ratio],
      quality: p.quality,
      n: 1,
      output_format: "png",
      moderation: "low",
      ...(p.references.length ? { image: p.references } : {}),
    }),
    route: { provider: ROUTER, providerModel: def.providerModel },
  });
}

/**
 * Nano Banana bills tokens after the fact; the price before the start is the ComfyUI node's estimate per resolution
 * (docs.comfy.org pricing and node badges, 16.10.2026). A reference image is priced at 1,120 input tokens, twice what
 * one measured elsewhere (560), at the model's input rate.
 */
const NANO_ASPECTS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
function nanoBanana(def: {
  jobType: string; model: string; tagline: string; badge?: "neu" | "top"; providerModel: string;
  price: Record<"1K" | "2K" | "4K", number>; perReference: number; thinking?: "MINIMAL";
}) {
  return jobType({
    jobType: def.jobType,
    kind: "image",
    model: def.model,
    tagline: def.tagline,
    ...(def.badge ? { badge: def.badge } : {}),
    family: "nano-banana",
    params: z.object({
      prompt,
      aspect_ratio: z.enum(NANO_ASPECTS).default("1:1"),
      resolution: z.enum(["1K", "2K", "4K"]).default("2K"),
      references: references(14),
    }),
    credits: (p) => creditsFromComfy(def.price[p.resolution] + def.perReference * p.references.length),
    vendorParams: (p) => ({
      contents: [{ role: "user", parts: [{ text: p.prompt }, ...p.references.map(inlineData)] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: p.aspect_ratio, imageSize: p.resolution },
        ...(def.thinking ? { thinkingConfig: { thinkingLevel: def.thinking } } : {}),
      },
      // The image comes back as a link instead of base64 in the answer.
      uploadImagesToStorage: true,
    }),
    route: { provider: ROUTER, providerModel: def.providerModel },
  });
}

/** Qwen Image takes "W*H": 1K up to 2.25 MP (12.07), 2K above (22.63), plus 0.91 per input image (16.10.2026). */
const QWEN_SIZE = {
  "1K": { "1:1": "1328*1328", "16:9": "1664*928", "9:16": "928*1664", "4:3": "1472*1104", "3:4": "1104*1472", "3:2": "1584*1056", "2:3": "1056*1584" },
  "2K": { "1:1": "2048*2048", "16:9": "2688*1512", "9:16": "1512*2688", "4:3": "2368*1776", "3:4": "1776*2368", "3:2": "2496*1664", "2:3": "1664*2496" },
} as const;
const QWEN_IMAGE = { "1K": 12.07, "2K": 22.63 } as const;

/** FLUX.2 takes width and height up to 2048 (multiples of 32) and bills per started megapixel (16.10.2026). */
const FLUX_2_SIZE = {
  "1K": { "1:1": [1024, 1024], "16:9": [1344, 768], "9:16": [768, 1344], "4:3": [1152, 864], "3:4": [864, 1152], "3:2": [1216, 832], "2:3": [832, 1216], "21:9": [1536, 640] },
  "2K": { "1:1": [2048, 2048], "16:9": [2048, 1152], "9:16": [1152, 2048], "4:3": [2048, 1536], "3:4": [1536, 2048], "3:2": [2048, 1344], "2:3": [1344, 2048], "21:9": [2048, 864] },
} as const;
const megapixels = (w: number, h: number) => Math.max(1, Math.ceil((w * h) / 1_048_576));

/**
 * FLUX.2 Pro or Max: first megapixel plus each further one; references go as bare base64 in input_image,
 * input_image_2 … and are priced as one more megapixel each (the node's range tops out there).
 */
function flux2(def: { jobType: string; model: string; tagline: string; providerModel: string; first: number; more: number }) {
  return jobType({
    jobType: def.jobType,
    kind: "image",
    model: def.model,
    tagline: def.tagline,
    family: "flux",
    params: z.object({
      prompt,
      aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"]).default("1:1"),
      resolution: z.enum(["1K", "2K"]).default("1K"),
      references: references(8),
    }),
    credits: (p) => {
      const [w, h] = FLUX_2_SIZE[p.resolution][p.aspect_ratio];
      return creditsFromComfy(def.first + def.more * (megapixels(w, h) - 1 + p.references.length));
    },
    vendorParams: (p) => {
      const [width, height] = FLUX_2_SIZE[p.resolution][p.aspect_ratio];
      return {
        prompt: p.prompt, width, height, output_format: "png", prompt_upsampling: false,
        ...Object.fromEntries(p.references.map((r, i) => [i ? `input_image_${i + 1}` : "input_image", rawBase64(r)])),
      };
    },
    route: { provider: ROUTER, providerModel: def.providerModel },
  });
}

/** Veo 3.1 and Fast per second, silent or with sound (docs.comfy.org pricing, 16.10.2026). */
const VEO_31 = {
  veo31: { "720p": { silent: 42.2, audio: 84.4 }, "1080p": { silent: 42.2, audio: 84.4 }, "4K": { silent: 84.4, audio: 126.6 } },
  veo31Fast: { "720p": { silent: 16.88, audio: 21.1 }, "1080p": { silent: 21.1, audio: 25.32 }, "4K": { silent: 52.75, audio: 63.3 } },
} as const;

/**
 * Veo 3.1 or Fast: 4, 6 or 8 s, up to 4K, from text or a start and end frame (PNG or JPEG, as bytes). Google renders
 * 1080p and 4K only as 8 s clips, so shorter clips stop at 720p.
 */
function veo31(def: { jobType: string; model: string; tagline: string; providerModel: string; rates: (typeof VEO_31)[keyof typeof VEO_31] }) {
  return jobType({
    jobType: def.jobType,
    kind: "video",
    model: def.model,
    tagline: def.tagline,
    family: "veo",
    params: z.object({
      prompt,
      image: frameImage,
      end_image: frameImage,
      duration: z.union([z.literal(4), z.literal(6), z.literal(8)]).default(8),
      resolution: z.enum(["720p", "1080p", "4K"]).default("720p"),
      aspect_ratio: z.enum(["16:9", "9:16"]).default("16:9"),
      generate_audio: z.boolean().default(true),
    }).refine(endNeedsStart, END_NEEDS_START).refine((p) => p.resolution === "720p" || p.duration === 8, { message: "1080p and 4K only at 8 seconds", path: ["resolution"] }),
    credits: (p) => creditsFromComfy(def.rates[p.resolution][p.generate_audio ? "audio" : "silent"] * p.duration),
    vendorParams: (p) => ({
      instances: [{ prompt: p.prompt, ...(p.image ? { image: inlineBase64(p.image) } : {}), ...(p.end_image ? { lastFrame: inlineBase64(p.end_image) } : {}) }],
      parameters: { durationSeconds: p.duration, aspectRatio: p.aspect_ratio, resolution: p.resolution.toLowerCase(), generateAudio: p.generate_audio, sampleCount: 1 },
    }),
    route: { provider: ROUTER, providerModel: def.providerModel },
  });
}

/** Wan 3.0 and Prime per second by resolution; sound costs nothing extra (docs.comfy.org pricing, 16.10.2026). */
const WAN_30 = { wan30: { "480p": 15.09, "720p": 30.17, "1080p": 60.35 }, wan30Prime: { "480p": 20.52, "720p": 42.24, "1080p": 84.48 } } as const;

/**
 * Wan 3.0 or Prime: 2 to 30 s from text or a start and end frame. "-1" (the model picks the length) is not offered: its
 * price would not be known before the start. The prompt is already written by the skill, so no second rewrite.
 */
function wan30(def: { jobType: string; model: string; tagline: string; badge?: "neu" | "top"; providerModel: string; rates: (typeof WAN_30)[keyof typeof WAN_30] }) {
  return jobType({
    jobType: def.jobType,
    kind: "video",
    model: def.model,
    tagline: def.tagline,
    ...(def.badge ? { badge: def.badge } : {}),
    family: "wan",
    params: z.object({
      prompt,
      image: startImage,
      end_image: startImage,
      duration: z.number().int().min(2).max(30).default(5),
      resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
      aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]).default("16:9"),
      generate_audio: z.boolean().default(true),
    }).refine(endNeedsStart, END_NEEDS_START),
    credits: (p) => creditsFromComfy(def.rates[p.resolution] * p.duration),
    vendorParams: (p) => ({
      input: {
        prompt: p.prompt,
        ...(p.image ? { media: [{ type: "first_frame", url: p.image }, ...(p.end_image ? [{ type: "last_frame", url: p.end_image }] : [])] } : {}),
      },
      parameters: {
        resolution: p.resolution.toUpperCase(),
        // With a start frame the clip takes the frame's format.
        ratio: p.image ? "adaptive" : p.aspect_ratio,
        duration: p.duration,
        audio: p.generate_audio,
        prompt_extend: false,
        watermark: false,
      },
    }),
    route: { provider: ROUTER, providerModel: def.providerModel },
  });
}

/** Grok Imagine video per second by resolution, plus 3.02 once for a start image (docs.comfy.org pricing, 16.10.2026). */
const GROK_VIDEO = { grok15: { "480p": 24.14, "720p": 42.24, "1080p": 75.43 }, grok15Lite: { "480p": 6.03, "720p": 9.05 } } as const;

/** Grok Imagine 1.5 or Lite: 1 to 15 s from text or a start image (whose format the clip then takes). */
function grokVideo(def: { jobType: string; model: string; tagline: string; providerModel: string; rates: Record<string, number>; resolutions: readonly [string, ...string[]] }) {
  return jobType({
    jobType: def.jobType,
    kind: "video",
    model: def.model,
    tagline: def.tagline,
    family: "grok",
    params: z.object({
      prompt,
      image: startImage,
      duration: z.number().int().min(1).max(15).default(5),
      resolution: z.enum(def.resolutions).default("720p"),
      aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"]).default("16:9"),
    }),
    credits: (p) => creditsFromComfy(def.rates[p.resolution]! * p.duration + (p.image ? 3.02 : 0)),
    vendorParams: (p) => ({
      prompt: p.prompt,
      duration: p.duration,
      resolution: p.resolution,
      ...(p.image ? { image: { url: p.image } } : { aspect_ratio: p.aspect_ratio }),
    }),
    route: { provider: ROUTER, providerModel: def.providerModel },
  });
}

/** Kling O1 per second: std renders 720p, pro 1080p; no sound (docs.comfy.org pricing, 16.10.2026). */
const KLING_O1 = { "720p": 17.72, "1080p": 23.63 } as const;

/**
 * Wan 2.7 and HappyHorse 1.1 serve text and a start image under two router ids each (routeFor picks one). Their vendor
 * cuts prompts after 800 characters. Per second by resolution
 * (docs.comfy.org pricing, 16.10.2026). Sound comes with every clip; there is no switch.
 */
const WAN_27 = { "720p": 21.1, "1080p": 31.65 } as const;
const HAPPYHORSE_11 = { "720p": 42.24, "1080p": 54.31 } as const;
const shortPrompt = z.string().trim().min(1).max(800);
const dashscopeAspect = z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]).default("16:9");

/** One of the caller's own images, required (the image tools work on it). */
const ownImage = z.string().regex(OWN_IMAGE);
/** The tools need no wish; the field stays for the shared job flow (prompt skill, studio composer). */
const toolNote = (max: number) => z.string().trim().max(max).default("");
/**
 * An own video with its size and length in the name ("…-1280x720_12s.mp4", uploads.ts). The name rounds the length to
 * whole seconds, so the price counts half a second more: the vendor bills the real length.
 */
const SIZED_VIDEO = /^\/api\/media\/uploads\/[0-9a-f-]{36}\/[A-Za-z0-9-]+-(\d{2,5})x(\d{2,5})_(\d{1,3})s\.mp4$/;
const videoSizeOf = (url: string) => {
  const m = SIZED_VIDEO.exec(url);
  return m ? { width: Number(m[1]), height: Number(m[2]), seconds: Number(m[3]) } : { width: 0, height: 0, seconds: 0 };
};
const billedSeconds = (seconds: number) => seconds + 0.5;
/** FLUX Video Upscale per output megapixel and second (docs.comfy.org pricing, 16.10.2026); output stays within 4K. */
const VIDEO_UPSCALE = { precise: 21.12, creative: 30.17 } as const;
const UPSCALE_MAX_LONG = 3840;
/** The pricing page starts at 1080p (~2.07 MP): a smaller output is priced as 1080p, on the safe side. */
const UPSCALE_MIN_MP = 2.07;
/** Bria Relight's light types where the router schema and the ComfyUI node spell them alike (three differ). */
const LIGHT_TYPES = [
  "midday", "blue hour light", "low-angle sunlight", "sunrise light", "overcast light", "soft overcast daylight lighting",
  "cloud-filtered lighting", "fog-diffused lighting", "moonlight lighting", "soft bokeh lighting",
] as const;

const LTX_SIZE = { "720p": { "16:9": "1280x720", "9:16": "720x1280" }, "1080p": { "16:9": "1920x1080", "9:16": "1080x1920" } } as const;

export function createCatalog(): Register {
  return defineRegister([
    jobType({
      jobType: "flux_3_image",
      kind: "image",
      model: "FLUX 3",
      tagline: "Black Forest Labs · photoreal detail, exact colours, edits with up to 10 references",
      badge: "neu",
      family: "flux",
      params: z.object({
        prompt,
        aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"]).default("1:1"),
        resolution: z.enum(["768sq", "1k", "1.5k", "2k", "4k"]).default("1k"),
        references: references(10),
      }),
      credits: (p) => creditsFromComfy(FLUX_3_IMAGE[p.resolution]),
      vendorParams: ({ references: refs, ...p }) => ({ ...p, ...(refs.length ? { images: refs } : {}) }),
      route: { provider: ROUTER, providerModel: "bfl/flux-3-image" },
    }),
    jobType({
      jobType: "seedream_4_5",
      kind: "image",
      model: "Seedream 4.5",
      tagline: "ByteDance · photoreal in 2K or 4K, edits with up to 14 references",
      family: "seedream",
      params: z.object({
        prompt,
        aspect_ratio: z.enum(IMAGE_ASPECTS).default("1:1"),
        resolution: z.enum(["2K", "4K"]).default("2K"),
        references: references(14),
      }),
      // One price for 2K and 4K (docs.comfy.org pricing, 16.10.2026).
      credits: (p) => creditsFromComfy(8.44 + SEEDREAM_PER_REFERENCE * p.references.length),
      vendorParams: (p) => ({
        prompt: p.prompt,
        size: SEEDREAM_45_SIZE[p.resolution][p.aspect_ratio],
        ...(p.references.length ? { image: p.references } : {}),
        // One image per job: no sequence (each further image is billed), no watermark (default on).
        sequential_image_generation: "disabled",
        response_format: "url",
        watermark: false,
      }),
      route: { provider: ROUTER, providerModel: "byteplus/seedream-4-5-251128" },
    }),
    seedream5({
      jobType: "seedream_5_0_pro", model: "Seedream 5 Pro", tagline: "ByteDance · precise edits and layouts, 1K or 2K, up to 10 references",
      providerModel: "byteplus/seedream-5-0-pro-260628", sizes: SEEDREAM_50_PRO_SIZE, price: (r) => SEEDREAM_50_PRO[r],
    }),
    seedream5({
      jobType: "seedream_5_0_flash", model: "Seedream 5 Flash", tagline: "ByteDance · very fast and cheap, 1K or 2K",
      providerModel: "byteplus/seedream-5-0-flash-260915", sizes: SEEDREAM_50_FLASH_SIZE, price: () => 5.43,
    }),
    gptImage({ jobType: "gpt_image_2_5_sunburst", model: "GPT Image 2.5", tagline: "OpenAI · precise, text in the image, edits with references", badge: "top", providerModel: "openai/gpt-image-2.5-sunburst" }),
    gptImage({ jobType: "gpt_image_2_5_flare", model: "GPT Image 2.5 Flare", tagline: "OpenAI · the faster variant, same settings", providerModel: "openai/gpt-image-2.5-flare" }),
    nanoBanana({
      jobType: "nano_banana_pro", model: "Nano Banana Pro", tagline: "Google · edits with up to 14 references, up to 4K", badge: "top",
      providerModel: "vertexai/gemini-3-pro-image", price: { "1K": 33.93, "2K": 33.93, "4K": 60.77 }, perReference: 1.12 * 0.5064,
    }),
    nanoBanana({
      jobType: "nano_banana_2", model: "Nano Banana 2", tagline: "Google · fast edits, up to 4K",
      providerModel: "vertexai/gemini-3.1-flash-image", price: { "1K": 17.62, "2K": 25.68, "4K": 38.99 }, perReference: 1.12 * 0.1266, thinking: "MINIMAL",
    }),
    jobType({
      jobType: "qwen_image_3_pro",
      kind: "image",
      model: "Qwen Image 3 Pro",
      tagline: "Alibaba · lots of legible text in the image, edits with up to 3 references",
      family: "qwen-image",
      params: z.object({
        prompt,
        aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]).default("1:1"),
        resolution: z.enum(["1K", "2K"]).default("1K"),
        references: references(3),
      }),
      credits: (p) => creditsFromComfy(QWEN_IMAGE[p.resolution] + 0.91 * p.references.length),
      vendorParams: (p) => ({
        input: { messages: [{ role: "user", content: [{ text: p.prompt }, ...p.references.map((image) => ({ image }))] }] },
        // The prompt is already written by the skill: no second rewrite.
        parameters: { size: QWEN_SIZE[p.resolution][p.aspect_ratio], n: 1, prompt_extend: false, watermark: false },
      }),
      route: { provider: ROUTER, providerModel: "qwen/qwen-image-3.0-pro" },
    }),
    jobType({
      jobType: "grok_imagine_image_2_0",
      kind: "image",
      model: "Grok Imagine Image 2.0",
      tagline: "xAI · cinematic stills from text, 1K or 2K",
      family: "grok-image",
      params: z.object({
        prompt,
        aspect_ratio: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "1:2", "2:1"]).default("1:1"),
        resolution: z.enum(["1K", "2K"]).default("1K"),
        quality: z.enum(["low", "medium"]).default("medium"),
      }),
      // Per image by quality and resolution (16.10.2026); "high" has no listed price and is not offered.
      credits: (p) => creditsFromComfy({ low: { "1K": 8.44, "2K": 12.66 }, medium: { "1K": 12.66, "2K": 16.88 } }[p.quality][p.resolution]),
      vendorParams: (p) => ({ prompt: p.prompt, aspect_ratio: p.aspect_ratio, resolution: p.resolution.toLowerCase(), quality: p.quality, n: 1 }),
      route: { provider: ROUTER, providerModel: "xai/grok-imagine-image-2.0" },
    }),
    flux2({ jobType: "flux_2_pro", model: "FLUX.2 Pro", tagline: "Black Forest Labs · fine detail, edits with up to 8 references", providerModel: "bfl/flux-2-pro", first: 6.33, more: 3.17 }),
    flux2({ jobType: "flux_2_max", model: "FLUX.2 Max", tagline: "Black Forest Labs · the highest FLUX.2 quality", providerModel: "bfl/flux-2-max", first: 14.77, more: 6.33 }),
    jobType({
      jobType: "minimax_h3",
      kind: "video",
      model: "MiniMax H3",
      tagline: "MiniMax · 4 to 15 s with sound, from text or a start image",
      badge: "neu",
      family: "minimax",
      params: z.object({
        prompt,
        image: startImage,
        duration: z.number().int().min(4).max(15).default(6),
        resolution: z.enum(["768P", "2K"]).default("768P"),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]).default("16:9"),
      }),
      credits: (p) => creditsFromComfy(PER_SECOND.minimaxH3[p.resolution] * p.duration),
      vendorParams: (p) => ({
        content: [{ type: "text", text: p.prompt }, ...(p.image ? [{ type: "image_url", image_url: { url: p.image } }] : [])],
        duration: p.duration,
        resolution: p.resolution,
        ratio: p.aspect_ratio,
      }),
      route: { provider: ROUTER, providerModel: "minimax/minimax-h3" },
    }),
    jobType({
      jobType: "ltx_2_5_fast",
      kind: "video",
      model: "LTX-2.5 Fast",
      tagline: "Lightricks · fast video with sound, up to 20 s",
      family: "ltx",
      params: z.object({
        prompt,
        duration: z.union([2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20].map((n) => z.literal(n)) as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]).default(6),
        resolution: z.enum(["720p", "1080p"]).default("1080p"),
        aspect_ratio: z.enum(["16:9", "9:16"]).default("16:9"),
        generate_audio: z.boolean().default(true),
      }),
      credits: (p) => creditsFromComfy(PER_SECOND.ltx25Fast[p.resolution] * p.duration),
      vendorParams: (p) => ({
        prompt: p.prompt, duration: p.duration, resolution: LTX_SIZE[p.resolution][p.aspect_ratio], fps: 25, generate_audio: p.generate_audio,
      }),
      route: { provider: ROUTER, providerModel: "ltx/ltx-2-5-fast" },
    }),
    jobType({
      jobType: "kling_3_turbo",
      kind: "video",
      model: "Kling 3.0 Turbo",
      tagline: "Kuaishou · lively motion with sound, 3 to 15 s",
      family: "kling",
      params: z.object({
        prompt: z.string().trim().min(1).max(3000),
        duration: z.number().int().min(3).max(15).default(5),
        resolution: z.enum(["720p", "1080p"]).default("720p"),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
      }),
      credits: (p) => creditsFromComfy(PER_SECOND.kling30Turbo[p.resolution] * p.duration),
      vendorParams: (p) => ({ prompt: p.prompt, settings: { duration: p.duration, resolution: p.resolution, aspect_ratio: p.aspect_ratio } }),
      route: { provider: ROUTER, providerModel: "kling/kling-3.0-turbo" },
    }),
    kling3({ jobType: "kling_3_std", model: "Kling 3.0", tagline: "Kuaishou · fluid motion, 3 to 15 s at 720p, from text or start and end frames", mode: "std", audio: false }),
    kling3({ jobType: "kling_3_0_pro", model: "Kling 3.0 Pro", tagline: "Kuaishou · fluid motion in 1080p with sound, 3 to 15 s", mode: "pro", audio: true }),
    jobType({
      jobType: "veo_3_1_lite",
      kind: "video",
      model: "Veo 3.1 Lite",
      tagline: "Google · the cheap draft model, 4 to 8 s, with or without sound",
      family: "veo",
      params: z.object({
        prompt,
        image: frameImage,
        duration: z.union([z.literal(4), z.literal(6), z.literal(8)]).default(8),
        resolution: z.enum(["720p", "1080p"]).default("720p"),
        aspect_ratio: z.enum(["16:9", "9:16"]).default("16:9"),
        generate_audio: z.boolean().default(true),
      }),
      credits: (p) => creditsFromComfy(PER_SECOND.veo31Lite[p.resolution][p.generate_audio ? "audio" : "silent"] * p.duration),
      vendorParams: (p) => ({
        instances: [{ prompt: p.prompt, ...(p.image ? { image: inlineBase64(p.image) } : {}) }],
        parameters: { durationSeconds: p.duration, aspectRatio: p.aspect_ratio, resolution: p.resolution, generateAudio: p.generate_audio, sampleCount: 1 },
      }),
      route: { provider: ROUTER, providerModel: "veo/veo-3.1-lite-generate-001" },
    }),
    jobType({
      jobType: "seedance_2_5",
      kind: "video",
      model: "Seedance 2.5",
      tagline: "ByteDance · cinematic shots with sound, from text or a start image, up to 1080p",
      badge: "top",
      family: "seedance",
      params: z.object({
        prompt,
        image: startImage,
        duration: z.number().int().min(4).max(12).default(5),
        resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
        generate_audio: z.boolean().default(true),
      }),
      credits: (p) => {
        const [w, h] = SEEDANCE_25_FRAME[p.resolution][p.aspect_ratio];
        return creditsFromComfy(((p.duration * w * h * 24) / 1024 / 1000) * SEEDANCE_25_PER_1K[p.resolution]);
      },
      vendorParams: (p) => ({
        content: [{ type: "text", text: p.prompt }, ...(p.image ? [{ type: "image_url", image_url: { url: p.image }, role: "first_frame" }] : [])],
        resolution: p.resolution, ratio: p.aspect_ratio, duration: p.duration, generate_audio: p.generate_audio, watermark: false,
      }),
      route: { provider: ROUTER, providerModel: "byteplus/dreamina-seedance-2-5-260628" },
    }),
    veo31({ jobType: "veo_3_1", model: "Veo 3.1", tagline: "Google · the top quality, with sound, up to 4K", providerModel: "veo/veo-3.1-generate-001", rates: VEO_31.veo31 }),
    veo31({ jobType: "veo_3_1_fast", model: "Veo 3.1 Fast", tagline: "Google · fast, with sound, up to 4K", providerModel: "veo/veo-3.1-fast-generate-001", rates: VEO_31.veo31Fast }),
    jobType({
      jobType: "kling_o1",
      kind: "video",
      model: "Kling O1",
      tagline: "Kuaishou · 5 or 10 s, from text or a start and end frame, no sound",
      family: "kling",
      params: z.object({
        prompt: z.string().trim().min(1).max(2500),
        image: frameImage,
        end_image: frameImage,
        // The node allows 3–10 s only with an end frame; 5 and 10 work in every mode.
        duration: z.union([z.literal(5), z.literal(10)]).default(5),
        resolution: z.enum(["720p", "1080p"]).default("720p"),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
      }).refine(endNeedsStart, END_NEEDS_START),
      credits: (p) => creditsFromComfy(KLING_O1[p.resolution] * p.duration),
      vendorParams: (p) => ({
        prompt: p.prompt,
        mode: p.resolution === "1080p" ? "pro" : "std",
        duration: String(p.duration),
        ...(p.image
          ? { image_list: [{ image_url: rawBase64(p.image), type: "first_frame" }, ...(p.end_image ? [{ image_url: rawBase64(p.end_image), type: "end_frame" }] : [])] }
          : { aspect_ratio: p.aspect_ratio }),
      }),
      route: { provider: ROUTER, providerModel: "kling/kling-video-o1" },
    }),
    wan30({ jobType: "wan_3_0", model: "Wan 3.0", tagline: "Alibaba · up to 30 s with sound, from text or start and end frames", badge: "neu", providerModel: "wan/wan3.0-video", rates: WAN_30.wan30 }),
    wan30({ jobType: "wan_3_0_prime", model: "Wan 3.0 Prime", tagline: "Alibaba · the highest Wan quality, up to 30 s", providerModel: "wan/wan3.0-video-prime", rates: WAN_30.wan30Prime }),
    grokVideo({
      jobType: "grok_imagine_1_5", model: "Grok Imagine 1.5", tagline: "xAI · 1 to 15 s from text or a photo, up to 1080p",
      providerModel: "xai/grok-imagine-video-1.5", rates: GROK_VIDEO.grok15, resolutions: ["480p", "720p", "1080p"],
    }),
    grokVideo({
      // Lite stops at 720p: its 1080p costs almost five times as much.
      jobType: "grok_imagine_1_5_lite", model: "Grok Imagine 1.5 Lite", tagline: "xAI · very cheap drafts, up to 720p",
      providerModel: "xai/grok-imagine-video-1.5-lite", rates: GROK_VIDEO.grok15Lite, resolutions: ["480p", "720p"],
    }),
    jobType({
      jobType: "flux_3_video",
      kind: "video",
      model: "FLUX 3 Video",
      tagline: "Black Forest Labs · dialogue, cuts and lettering, 5 to 20 s",
      badge: "neu",
      family: "flux-video",
      params: z.object({
        prompt,
        image: startImage,
        end_image: startImage,
        duration: z.number().int().min(5).max(20).default(5),
        resolution: z.enum(["720p", "1080p"]).default("720p"),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]).default("16:9"),
        generate_audio: z.boolean().default(true),
      }).refine(endNeedsStart, END_NEEDS_START),
      // Per second, sound included: hd 51.29, fhd 87.50 (docs.comfy.org pricing, 16.10.2026).
      credits: (p) => creditsFromComfy((p.resolution === "1080p" ? 87.5 : 51.29) * p.duration),
      // A length always goes as a number ("auto" would leave the price open). With frames the clip takes their format.
      vendorParams: (p) => ({
        mode: p.image ? "i2v" : "t2v",
        prompt: p.prompt,
        duration: p.duration,
        resolution: p.resolution === "1080p" ? "fhd" : "hd",
        aspect_ratio: p.image ? "auto" : p.aspect_ratio,
        generate_audio: p.generate_audio,
        ...(p.image ? { keyframes: [p.image, ...(p.end_image ? [p.end_image] : [])] } : {}),
      }),
      route: { provider: ROUTER, providerModel: "bfl/flux-3-video" },
    }),
    jobType({
      jobType: "seedance_2_0",
      kind: "video",
      model: "Seedance 2.0",
      tagline: "ByteDance · cinematic scenes with sound, up to 1080p and 15 s",
      family: "seedance",
      params: z.object({
        prompt,
        image: startImage,
        end_image: startImage,
        duration: z.number().int().min(4).max(15).default(5),
        resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
        generate_audio: z.boolean().default(true),
      }).refine(endNeedsStart, END_NEEDS_START),
      credits: (p) => {
        const [w, h] = SEEDANCE_20_FRAME[p.resolution][p.aspect_ratio];
        return creditsFromComfy(((p.duration * w * h * 24) / 1024 / 1000) * SEEDANCE_20_PER_1K[p.resolution]);
      },
      vendorParams: (p) => ({
        content: [
          { type: "text", text: p.prompt },
          ...(p.image ? [{ type: "image_url", image_url: { url: p.image }, role: "first_frame" }] : []),
          ...(p.end_image ? [{ type: "image_url", image_url: { url: p.end_image }, role: "last_frame" }] : []),
        ],
        resolution: p.resolution, ratio: p.aspect_ratio, duration: p.duration, generate_audio: p.generate_audio, watermark: false,
      }),
      route: { provider: ROUTER, providerModel: "byteplus/dreamina-seedance-2-0-260128" },
    }),
    jobType({
      jobType: "wan_2_7",
      kind: "video",
      model: "Wan 2.7",
      tagline: "Alibaba · versatile clips from text or a start and end frame, 2 to 15 s, sound included",
      family: "wan",
      params: z.object({
        prompt: shortPrompt,
        image: startImage,
        end_image: startImage,
        duration: z.number().int().min(2).max(15).default(5),
        resolution: z.enum(["720p", "1080p"]).default("720p"),
        aspect_ratio: dashscopeAspect,
      }).refine(endNeedsStart, END_NEEDS_START),
      credits: (p) => creditsFromComfy(WAN_27[p.resolution] * p.duration),
      // With a start frame the clip takes the frame's format: no ratio.
      vendorParams: (p) => ({
        input: {
          prompt: p.prompt,
          ...(p.image ? { media: [{ type: "first_frame", url: p.image }, ...(p.end_image ? [{ type: "last_frame", url: p.end_image }] : [])] } : {}),
        },
        parameters: {
          resolution: p.resolution.toUpperCase(), ...(p.image ? {} : { ratio: p.aspect_ratio }), duration: p.duration, prompt_extend: false, watermark: false,
        },
      }),
      route: { provider: ROUTER, providerModel: "wan/wan2.7-t2v" },
      routeFor: (p) => (p.image ? "wan/wan2.7-i2v" : "wan/wan2.7-t2v"),
      routes: ["wan/wan2.7-t2v", "wan/wan2.7-i2v"],
    }),
    jobType({
      jobType: "happyhorse_1_1",
      kind: "video",
      model: "HappyHorse 1.1",
      tagline: "Alibaba · short scenes with dialogue and sound, from text or a photo, 5 to 15 s",
      family: "happyhorse",
      // 5 s at least: the vendor was measured billing a 3 s clip like 5 s on another route.
      params: z.object({
        prompt: shortPrompt,
        image: startImage,
        duration: z.number().int().min(5).max(15).default(5),
        resolution: z.enum(["720p", "1080p"]).default("720p"),
        aspect_ratio: dashscopeAspect,
      }),
      credits: (p) => creditsFromComfy(HAPPYHORSE_11[p.resolution] * p.duration),
      vendorParams: (p) => ({
        input: { prompt: p.prompt, ...(p.image ? { media: [{ type: "first_frame", url: p.image }] } : {}) },
        parameters: { resolution: p.resolution.toUpperCase(), ...(p.image ? {} : { ratio: p.aspect_ratio }), duration: p.duration, watermark: false },
      }),
      route: { provider: ROUTER, providerModel: "wan/happyhorse-1.1-t2v" },
      routeFor: (p) => (p.image ? "wan/happyhorse-1.1-i2v" : "wan/happyhorse-1.1-t2v"),
      routes: ["wan/happyhorse-1.1-t2v", "wan/happyhorse-1.1-i2v"],
    }),
    jobType({
      jobType: "recast",
      kind: "video",
      model: "Recast",
      tagline: "Seedance 2.0 Fast · keeps a clip's motion and camera, swaps the scene",
      badge: "neu",
      family: "seedance",
      params: z.object({
        prompt,
        video: z.string().regex(OWN_VIDEO).refine((u) => videoSeconds(u) >= 2 && videoSeconds(u) <= 15, "reference video: 2 to 15 s"),
        image: startImage,
        duration: z.number().int().min(4).max(12).default(5),
        resolution: z.enum(["480p", "720p"]).default("480p"),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
        generate_audio: z.boolean().default(false),
      }),
      credits: (p) => {
        const [w, h] = SEEDANCE_FRAME[p.resolution][p.aspect_ratio];
        const tokens = ((videoSeconds(p.video) + p.duration) * w * h * 24) / 1024;
        return creditsFromComfy((tokens / 1000) * SEEDANCE_PER_1K_WITH_VIDEO);
      },
      vendorParams: (p) => ({
        content: [
          { type: "text", text: p.prompt },
          { type: "video_url", video_url: { url: p.video }, role: "reference_video" },
          ...(p.image ? [{ type: "image_url", image_url: { url: p.image }, role: "reference_image" }] : []),
        ],
        resolution: p.resolution, ratio: p.aspect_ratio, duration: p.duration, generate_audio: p.generate_audio, watermark: false,
      }),
      sample: { video: sampleVideo(4) },
      route: { provider: ROUTER, providerModel: "byteplus/dreamina-seedance-2-0-fast-260128" },
    }),
    // Image tools (Bria): one picture in, the picture changed out. Bria takes the picture as a link from the asset store.
    jobType({
      jobType: "cutout",
      kind: "image",
      model: "Cutout",
      tagline: "Removes the background, PNG with transparency",
      badge: "neu",
      family: "image-tools",
      params: z.object({ prompt: toolNote(500), image: ownImage }),
      credits: () => creditsFromComfy(3.8),
      vendorParams: (p) => ({ image: assetLink(p.image), preserve_alpha: true }),
      sample: { image: SAMPLE_UPLOAD },
      route: { provider: ROUTER, providerModel: "bria/image-edit-remove-background" },
    }),
    jobType({
      jobType: "upscale",
      kind: "image",
      model: "Upscale",
      tagline: "Sharper and larger, 2x or 4x, without inventing content",
      badge: "neu",
      family: "image-tools",
      params: z.object({ prompt: toolNote(500), image: ownImage, scale: z.enum(["2x", "4x"]).default("2x") }),
      // One price for 2x and 4x (docs.comfy.org pricing, 16.10.2026); the output stops at 8192 px a side.
      credits: () => creditsFromComfy(6.03),
      vendorParams: (p) => ({ image: assetLink(p.image), desired_increase: p.scale === "4x" ? 4 : 2, preserve_alpha: true }),
      sample: { image: SAMPLE_UPLOAD },
      route: { provider: ROUTER, providerModel: "bria/image-edit-increase-resolution" },
    }),
    jobType({
      jobType: "relight",
      kind: "image",
      model: "Relight",
      tagline: "New light on a photo: time of day, weather, direction",
      badge: "neu",
      family: "image-tools",
      params: z.object({
        prompt: toolNote(500), image: ownImage,
        light: z.enum(LIGHT_TYPES).default("soft overcast daylight lighting"),
        direction: z.enum(["front", "side", "bottom", "top-down"]).default("front"),
      }),
      credits: () => creditsFromComfy(12.07),
      vendorParams: (p) => ({ image: assetLink(p.image), light_type: p.light, light_direction: p.direction }),
      sample: { image: SAMPLE_UPLOAD },
      route: { provider: ROUTER, providerModel: "bria/image-edit-relight" },
    }),
    jobType({
      jobType: "replace_background",
      kind: "image",
      model: "Replace Background",
      tagline: "Keeps the subject, puts it in a new setting you describe",
      badge: "neu",
      family: "image-tools",
      params: z.object({ prompt: z.string().trim().min(3).max(500), image: ownImage }),
      credits: () => creditsFromComfy(12.07),
      // The prompt is already written by the skill (no refine); full quality instead of the 1 MP default.
      vendorParams: (p) => ({ image: assetLink(p.image), prompt: p.prompt, mode: "high_control", refine_prompt: false, original_quality: true }),
      sample: { prompt: "A sunlit marble kitchen counter", image: SAMPLE_UPLOAD },
      route: { provider: ROUTER, providerModel: "bria/image-edit-replace-background" },
    }),
    // Video tools (FLUX Video): the user's own clip, by a link from the asset store.
    jobType({
      jobType: "video_upscale",
      kind: "video",
      model: "Video Upscale",
      tagline: "Your video larger and sharper, up to 4K",
      badge: "neu",
      family: "video-upscale",
      params: z.object({
        prompt: toolNote(300),
        video: z.string().regex(SIZED_VIDEO, "video needs its size: upload it again")
          .refine((v) => videoSizeOf(v).seconds >= 1 && videoSizeOf(v).seconds <= 20, "video must be 1 to 20 seconds"),
        factor: z.enum(["1.5", "2", "3"]).default("2"),
        creativity: z.enum(["precise", "creative"]).default("precise"),
      }).refine((p) => Math.max(videoSizeOf(p.video).width, videoSizeOf(p.video).height) * Number(p.factor) <= UPSCALE_MAX_LONG, {
        message: `output must stay within ${UPSCALE_MAX_LONG} px on the long side`, path: ["factor"],
      }),
      credits: (p) => {
        const { width, height, seconds } = videoSizeOf(p.video);
        const f = Number(p.factor);
        const mp = Math.max(UPSCALE_MIN_MP, (width * f * height * f) / 1e6);
        return creditsFromComfy(VIDEO_UPSCALE[p.creativity] * mp * billedSeconds(seconds));
      },
      // Creativity always goes explicitly: the vendor's default is creative.
      vendorParams: (p) => ({
        input_video: p.video, upscale_factor: Number(p.factor), creativity: p.creativity === "creative" ? 1 : 0, ...(p.prompt ? { prompt: p.prompt } : {}),
      }),
      sample: { video: sampleVideo(10) },
      route: { provider: ROUTER, providerModel: "bfl/video-upscale-v1" },
    }),
    jobType({
      jobType: "video_edit",
      kind: "video",
      model: "Video Edit",
      tagline: "Your video: change, remove or replace things, the rest stays",
      badge: "neu",
      family: "video-edit",
      params: z.object({
        prompt: z.string().trim().min(3).max(1000),
        video: z.string().regex(OWN_VIDEO).refine((v) => videoSeconds(v) >= 1 && videoSeconds(v) <= 15, "video must be 1 to 15 seconds"),
      }),
      // Per second of the clip, which the output keeps (docs.comfy.org pricing, 16.10.2026). Sources above 720p come
      // back at about 720p.
      credits: (p) => creditsFromComfy(9.05 * billedSeconds(videoSeconds(p.video))),
      vendorParams: (p) => ({ video: p.video, prompt: p.prompt, safety_tolerance: 2 }),
      sample: { prompt: "Change the background to a deep blue studio wall, keep everything else unchanged", video: sampleVideo(10) },
      route: { provider: ROUTER, providerModel: "bfl/video-edit-v1" },
    }),
  ]);
}

export const catalog = createCatalog();
