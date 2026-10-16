import { z } from "zod";
import { creditsFromComfy } from "./pricing";
import { defineRegister, jobType, type Register } from "./register";

/**
 * The register of the open version: every job type runs on the Comfy Router (providers/comfy.ts), addressed by its
 * router id `{provider}/{model}`. Prices are the router's own, in Comfy credits per image or per second, as listed in
 * docs.comfy.org «Partner Nodes pricing» (checked 16.10.2026); pricing.ts turns them into credits. Adding a model is
 * one entry here plus a prompt skill in `skills/` that names its job type.
 */
const ROUTER = "comfy";

const prompt = z.string().trim().min(1).max(4000);
/** Our own uploads only: never a foreign URL (the server inlines them for the router). */
const OWN_IMAGE = /^\/api\/media\/uploads\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/;
const startImage = z.string().regex(OWN_IMAGE).optional();
const references = (max: number) => z.array(z.string().regex(OWN_IMAGE)).max(max).default([]);
/** A value the provider replaces with the file's bytes as `{ bytesBase64Encoded, mimeType }` (the Veo request shape). */
export const inlineBase64 = (url: string) => ({ $inlineBase64: url });

/** Comfy credits per image of FLUX 3 by resolution class. */
const FLUX_3_IMAGE = { "768sq": 12.37, "1k": 14.48, "1.5k": 21.12, "2k": 30.17, "4k": 183.15 } as const;
/** Comfy credits per second of video. */
const PER_SECOND = {
  minimaxH3: { "768P": 27.16, "2K": 39.22 },
  ltx25Fast: { "720p": 27.16, "1080p": 39.22 },
  kling30Turbo: { "720p": 23.63, "1080p": 29.54 },
  veo31Lite: { "720p": { silent: 6.33, audio: 10.55 }, "1080p": { silent: 10.55, audio: 16.88 } },
} as const;

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
    jobType({
      jobType: "veo_3_1_lite",
      kind: "video",
      model: "Veo 3.1 Lite",
      tagline: "Google · the cheap draft model, 4 to 8 s, with or without sound",
      family: "veo",
      params: z.object({
        prompt,
        image: startImage,
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
  ]);
}

export const catalog = createCatalog();
