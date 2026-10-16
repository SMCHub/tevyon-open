/**
 * Marketing Agent: a product photo (and optionally an avatar) becomes ready-to-post content in one of six
 * categories, with fixed categories, flows and per-flow rules (aspect ratios, durations, batch, which inputs), our own styles and
 * prompts. It is a composition layer like recipes.ts: every style runs on an existing job type of the register,
 * the prompt is our know-how and never leaves the server.
 */

export type MsCategoryId = "ugc" | "product" | "motion" | "ads" | "posters" | "marketplace";
/** How a style is produced: one generation type per flow (no saas_motion). */
export type MsFlow = "product_shots" | "product_shots_people" | "ads" | "poster" | "marketplace" | "motion" | "ugc";
export type MsKind = "image" | "video";

export const MS_CATEGORIES: { id: MsCategoryId; label: string; kind: MsKind }[] = [
  { id: "ugc", label: "UGC", kind: "video" },
  { id: "product", label: "Product shot", kind: "image" },
  { id: "motion", label: "Motion", kind: "video" },
  { id: "ads", label: "Ads", kind: "image" },
  { id: "posters", label: "Posters", kind: "image" },
  { id: "marketplace", label: "Marketplace", kind: "image" },
];

/** Image job for every still flow: up to 14 references, legible text, 2K. */
const IMAGE_JOB = "seedream_4_5";
/** Motion: Kling takes any whole second from 3 to 15, the flow allows 5 to 15. */
const MOTION_JOB = "kling_3_std";
/**
 * UGC: an avatar holds and talks about the product, in two steps. First a still (Seedream: product + avatar → the
 * person holding the product), then that still speaks (Veo, like the talking presets). Reference-to-video models
 * that take both photos at once refuse real faces, so the chain is the way.
 */
export const UGC_FRAME_JOB = IMAGE_JOB;
export const UGC_JOB = "veo_3_1_lite";

type Need = "required" | "optional" | "none";
export type FlowRules = {
  kind: MsKind;
  jobType: string;
  product: Need;
  avatar: Need;
  /** Choosable aspect ratios; empty = the style fixes the format. */
  aspects: string[];
  batch: boolean;
  /** Allowed lengths; `steps` when the model takes only some seconds (Veo: 4, 6, 8). */
  duration?: { min: number; max: number; default: number; steps?: number[] };
  adReference: boolean;
  /** UGC: the still made first, then animated by `jobType`. */
  frameJobType?: string;
};

// The per-flow sets, without "auto": our models need a format.
const IMAGE_ASPECTS = ["1:1", "3:2", "2:3", "4:3", "3:4", "9:16", "16:9", "21:9"];
const PEOPLE_ASPECTS = ["1:1", "3:2", "2:3", "4:3", "3:4", "9:16", "16:9"];
const ADS_ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];
/** Motion offers 21:9 … 9:16 there; Kling renders 16:9, 9:16 and 1:1. */
const MOTION_ASPECTS = ["16:9", "9:16", "1:1"];
/** Veo renders 9:16 and 16:9. */
const UGC_ASPECTS = ["9:16", "16:9"];

const FLOWS: Record<MsFlow, FlowRules> = {
  product_shots: { kind: "image", jobType: IMAGE_JOB, product: "required", avatar: "none", aspects: IMAGE_ASPECTS, batch: true, adReference: true },
  product_shots_people: { kind: "image", jobType: IMAGE_JOB, product: "required", avatar: "optional", aspects: PEOPLE_ASPECTS, batch: true, adReference: true },
  ads: { kind: "image", jobType: IMAGE_JOB, product: "required", avatar: "none", aspects: ADS_ASPECTS, batch: true, adReference: true },
  poster: { kind: "image", jobType: IMAGE_JOB, product: "optional", avatar: "none", aspects: [], batch: false, adReference: true },
  marketplace: { kind: "image", jobType: IMAGE_JOB, product: "required", avatar: "none", aspects: [], batch: true, adReference: false },
  motion: {
    kind: "video", jobType: MOTION_JOB, product: "optional", avatar: "none", aspects: MOTION_ASPECTS, batch: true,
    duration: { min: 5, max: 15, default: 5 }, adReference: false,
  },
  ugc: {
    kind: "video", jobType: UGC_JOB, frameJobType: UGC_FRAME_JOB, product: "required", avatar: "required", aspects: UGC_ASPECTS, batch: false,
    duration: { min: 4, max: 8, default: 8, steps: [4, 6, 8] }, adReference: false,
  },
};

export function flowRules(flow: MsFlow): FlowRules {
  return FLOWS[flow];
}

export type MsStyle = {
  id: string;
  category: MsCategoryId;
  flow: MsFlow;
  title: string;
  /** Sub-group in the style picker (Closeup, With model …). */
  group?: string;
  /** Default (and for flows without a choice: fixed) aspect ratio. */
  aspect: string;
  /**
   * The prompt, written to the skill of the flow's model. Placeholders: {product} (the product from its reference or
   * the user's description), {model} (the avatar or the style's own model, flows with an avatar only).
   */
  prompt: string;
  /** UGC: the still of step 1 (Seedream, product = image 1, avatar = image 2); `prompt` then animates it (Veo). */
  frame?: string;
  /** Who appears when the user brings no avatar (flows with an optional avatar). */
  model?: string;
  /** Placeholder of the wish field, a hint at what fits. */
  wishHint?: string;
  badge?: "neu" | "top";
  /** Example image (or clip) under public/, made with ChatGPT. */
  cover?: string;
  /** Format of the cover image (templates), for an uncropped wall. */
  coverShape?: string;
  /** Set on templates: the style they build on (style picker vs. template wall). */
  base?: string;
};

/**
 * A template of the wall: a concrete scene with its own cover. It runs as its base style, with its own prompt (same
 * placeholders) and format where it has them. Clicking it in the Studio fills the composer with that style and scene.
 */
export type MsTemplate = {
  id: string; style: string; title: string; prompt?: string; aspect?: string; badge?: "neu" | "top";
  /** UGC: the still of step 1 for this scene (same rules as the style's `frame`). */
  frame?: string;
};

/** Format of each cover image (ChatGPT renders 2:3, 3:4, 1:1, 9:16, 16:9 or 3:2), so the wall shows it uncropped. */
const COVER_SHAPE: Record<string, string> = { "tpl-marble-morning": "2:3", "tpl-citrus-splash": "2:3", "tpl-dune-shadow": "2:3", "tpl-peony-bed": "2:3", "tpl-float-sneaker": "2:3", "tpl-water-watch": "2:3", "tpl-studio-white": "2:3", "tpl-color-block": "2:3", "tpl-linen-coffee": "2:3", "tpl-frost-bottle": "2:3", "tpl-pastel-arches": "2:3", "tpl-neon-glass": "2:3", "tpl-moss-stone": "2:3", "tpl-breakfast-light": "2:3", "tpl-smile-can": "2:3", "tpl-towel-cream": "2:3", "tpl-cap-chips": "2:3", "tpl-sofa-drink": "2:3", "tpl-mirror-serum": "2:3", "tpl-pillow-hug": "2:3", "tpl-ad-citrus": "2:3", "tpl-ad-callouts": "1:1", "tpl-ad-before-after": "1:1", "tpl-ad-sale": "2:3", "tpl-po-swiss": "2:3", "tpl-po-riso": "2:3", "tpl-po-collage": "2:3", "tpl-po-neon": "2:3", "tpl-mk-white": "1:1", "tpl-mk-benefits": "1:1", "tpl-mk-inuse": "1:1", "tpl-mo-orbit": "3:2", "tpl-mo-kinetic": "2:3", "tpl-mo-collage": "1:1", "tpl-mo-splash": "3:4", "tpl-mo-ambient": "3:2", "tpl-ugc-selfie": "2:3", "tpl-ugc-unboxing": "2:3", "tpl-ugc-howto": "2:3", "tpl-ugc-street": "2:3", "tpl-glacier-lake": "3:4", "tpl-hand-stone": "3:4", "tpl-desert-coat": "2:3", "tpl-gallery-pose": "2:3", "tpl-ad-berry-claim": "3:4", "tpl-ad-mono-claim": "3:4", "tpl-ad-callouts-shoe": "1:1", "tpl-ad-callouts-serum": "1:1", "tpl-ad-split-clean": "1:1", "tpl-ad-split-hair": "1:1", "tpl-ad-sale-black": "9:16", "tpl-ad-sale-summer": "9:16", "tpl-ad-review-stars": "3:4", "tpl-ad-review-chat": "3:4", "tpl-ad-review-ugc": "3:4", "tpl-po-swiss-blue": "2:3", "tpl-po-swiss-orange": "2:3", "tpl-po-riso-green": "3:4", "tpl-po-riso-gig": "3:4", "tpl-po-collage-retro": "2:3", "tpl-po-collage-flower": "2:3", "tpl-po-neon-arcade": "2:3", "tpl-po-neon-tokyo": "2:3", "tpl-po-minimal-cream": "3:4", "tpl-po-minimal-black": "3:4", "tpl-po-minimal-sage": "3:4", "tpl-mk-white-sneaker": "1:1", "tpl-mk-white-bag": "1:1", "tpl-mk-benefits-blender": "1:1", "tpl-mk-benefits-pillow": "1:1", "tpl-mk-dim-bottle": "1:1", "tpl-mk-dim-lamp": "1:1", "tpl-mk-dim-backpack": "1:1", "tpl-mk-inuse-kitchen": "1:1", "tpl-mk-inuse-desk": "1:1", "tpl-mk-box-earbuds": "1:1", "tpl-mk-box-skincare": "1:1", "tpl-mk-box-coffee": "1:1", "tpl-mo-orbit-gold": "16:9", "tpl-mo-orbit-ice": "16:9", "tpl-mo-splash-milk": "9:16", "tpl-mo-splash-ocean": "9:16", "tpl-mo-kinetic-bold": "9:16", "tpl-mo-kinetic-mono": "9:16", "tpl-mo-collage-garden": "1:1", "tpl-mo-collage-space": "1:1", "tpl-mo-ambient-bath": "16:9", "tpl-mo-ambient-desk": "16:9", "tpl-mo-explode-citrus": "9:16", "tpl-mo-explode-cocoa": "9:16", "tpl-mo-explode-berry": "9:16", "tpl-ugc-selfie-car": "9:16", "tpl-ugc-selfie-cafe": "9:16", "tpl-ugc-unbox-sofa": "9:16", "tpl-ugc-unbox-door": "9:16", "tpl-ugc-howto-kitchen": "9:16", "tpl-ugc-howto-gym": "9:16", "tpl-ugc-street-park": "9:16", "tpl-ugc-street-bike": "9:16", "tpl-ugc-grwm-vanity": "9:16", "tpl-ugc-grwm-mirror": "9:16", "tpl-ugc-grwm-bath": "9:16" };

const cover = (id: string) => `/marketing/${id}.webp`;

export const MS_TEMPLATES: MsTemplate[] = [
  // Product shots, the largest group. Prompts follow prompt-seedream.
  { id: "tpl-marble-morning", style: "ps-plinth", title: "Marble morning", badge: "top",
    prompt: "Editorial product photo of {product}, standing on white marble, early morning sun through a window, soft long shadows, a sprig of eucalyptus beside it. Fresh premium skincare campaign style, sharp details." },
  { id: "tpl-citrus-splash", style: "ps-droplets", title: "Citrus splash", badge: "neu",
    prompt: "Commercial product photo of {product}, bursting through a splash of water with orange and grapefruit slices flying around it, bright blue sky background. Energetic summer drinks campaign style, frozen motion, crisp light." },
  { id: "tpl-dune-shadow", style: "ps-shadows", title: "Dune shadow",
    prompt: "Product photo of {product}, lying on a rippled sand dune in harsh midday sun, a crisp shadow of a palm leaf falling across it. Warm beige palette, minimal summer campaign style." },
  { id: "tpl-peony-bed", style: "ps-nature", title: "Peony bed",
    prompt: "Product photo of {product}, resting on a bed of pink peonies with loose petals around, soft diffuse light, three-quarter top view. Romantic beauty campaign style." },
  { id: "tpl-float-sneaker", style: "ps-pastel", title: "Weightless",
    prompt: "Product photo of {product}, floating in mid-air against a seamless pastel blue background, a few small pebbles suspended around it, a soft shadow below. Playful modern campaign style." },
  { id: "tpl-water-watch", style: "ps-droplets", title: "Water line",
    prompt: "Product photo of {product}, half submerged in clear rippling water on a dark stone, light caustics dancing over it. Cool luxury campaign style, high detail." },
  { id: "tpl-studio-white", style: "ps-plinth", title: "Studio white",
    prompt: "Minimal product photo of {product} on a seamless pure white studio set, one soft shadow. Clean catalogue campaign style, true colours, sharp details." },
  { id: "tpl-color-block", style: "ps-pastel", title: "Colour block", badge: "neu",
    prompt: "Product photo of {product}, standing on a bold colour-blocked set of cherry red and sunflower yellow planes, hard flash light with a crisp shadow. Pop art fashion campaign style." },
  { id: "tpl-linen-coffee", style: "ps-shadows", title: "Linen and oak",
    prompt: "Product photo of {product} on a linen cloth on an oak table, scattered coffee beans and a ceramic cup beside it, warm window light. Cosy artisan brand style." },
  { id: "tpl-frost-bottle", style: "ps-droplets", title: "Frost",
    prompt: "Product photo of {product}, pushed into crushed ice, frost and condensation droplets on its surface, cool blue backlight. Crisp premium drinks campaign style." },
  { id: "tpl-pastel-arches", style: "ps-pastel", title: "Pastel arches",
    prompt: "Product photo of {product} among pastel plaster arches and cylinders, peach and lilac palette, soft even light. Calm modern home brand style." },
  { id: "tpl-neon-glass", style: "ps-plinth", title: "Neon glass",
    prompt: "Product photo of {product} on wet black glass at night, pink and cyan neon reflections around it. Cinematic luxury campaign style, deep contrast." },
  { id: "tpl-moss-stone", style: "ps-nature", title: "Moss and stone",
    prompt: "Product photo of {product} on a mossy river stone with ferns around, morning mist in the background, soft forest light. Natural organic brand style." },
  { id: "tpl-breakfast-light", style: "ps-shadows", title: "Breakfast light",
    prompt: "Product photo of {product} on a breakfast table with yoghurt, berries and a glass of juice, slatted sunlight through blinds. Fresh morning lifestyle campaign style." },
  // With a model: {model} is the avatar or the style's own model.
  { id: "tpl-smile-can", style: "pp-lifestyle", title: "Rooftop smile", badge: "top",
    prompt: "Lifestyle photo: {model} laughs and holds {product} next to their face on a sunny rooftop, clear blue sky behind. Bright, joyful summer campaign style." },
  { id: "tpl-towel-cream", style: "pp-hand", title: "Fresh out of the shower",
    prompt: "Beauty photo: {model} with a towel wrapped around the hair holds {product} to the cheek, fresh glowing skin, bright bathroom light. Clean skincare campaign style." },
  { id: "tpl-cap-chips", style: "pp-lifestyle", title: "Streetwear",
    prompt: "Low-angle street photo: {model} in a bucket hat holds {product} toward the camera against a clear sky. Bold streetwear campaign style, saturated colours." },
  { id: "tpl-sofa-drink", style: "pp-lifestyle", title: "Sofa moment",
    prompt: "Lifestyle photo: {model} sits cross-legged on a mustard yellow sofa, laughing and holding {product}, colourful living room. Warm, candid campaign style." },
  { id: "tpl-mirror-serum", style: "pp-hand", title: "Mirror selfie",
    prompt: "Authentic mirror selfie: {model} in a bright bathroom holds {product} up toward the mirror, natural light. Real creator social media style." },
  { id: "tpl-pillow-hug", style: "pp-fullbody", title: "Pillow hug",
    prompt: "Studio photo: {model} in green silk pyjamas hugs a terracotta pillow and holds {product}, warm plain studio background. Soft editorial wellness campaign style." },
  // Ads, posters, marketplace, motion and UGC: the style's own prompt with a cover of its look.
  { id: "tpl-ad-citrus", style: "ad-claim", title: "Citrus claim", badge: "top" },
  { id: "tpl-ad-callouts", style: "ad-callouts", title: "Three benefits" },
  { id: "tpl-ad-before-after", style: "ad-split", title: "Before / after" },
  { id: "tpl-ad-sale", style: "ad-sale", title: "Weekend sale" },
  { id: "tpl-po-swiss", style: "po-swiss", title: "Swiss grid" },
  { id: "tpl-po-riso", style: "po-riso", title: "Risograph" },
  { id: "tpl-po-collage", style: "po-collage", title: "Collage" },
  { id: "tpl-po-neon", style: "po-neon", title: "Neon night" },
  { id: "tpl-mk-white", style: "mk-white", title: "Main image white" },
  { id: "tpl-mk-benefits", style: "mk-benefits", title: "Benefits" },
  { id: "tpl-mk-inuse", style: "mk-lifestyle", title: "In use" },
  { id: "tpl-mo-orbit", style: "mo-orbit", title: "Orbit", badge: "top" },
  { id: "tpl-mo-kinetic", style: "mo-kinetic", title: "Kinetic type" },
  { id: "tpl-mo-collage", style: "mo-collage", title: "Paper collage" },
  { id: "tpl-mo-splash", style: "mo-splash", title: "Splash" },
  { id: "tpl-mo-ambient", style: "mo-ambient", title: "Ambient light" },
  { id: "tpl-ugc-selfie", style: "ugc-selfie-review", title: "Selfie review", badge: "top" },
  { id: "tpl-ugc-unboxing", style: "ugc-unboxing", title: "Unboxing" },
  { id: "tpl-ugc-howto", style: "ugc-tutorial", title: "How-to" },
  { id: "tpl-ugc-street", style: "ugc-street", title: "On the go" },
  // Second wave: every style has at least three templates.
  { id: "tpl-glacier-lake", style: "ps-nature", title: "Alpine lake",
    prompt: "Outdoor product photo of {product}, standing on a flat granite rock at the edge of a clear alpine lake, snowy peaks mirrored in the water behind it. Crisp morning light, cool blue and green palette, pure outdoor brand style, the product in sharp focus." },
  { id: "tpl-hand-stone", style: "pp-hand", title: "Stone wall",
    prompt: "Close-up lifestyle photo: {model} holds {product} toward the camera in front of a sunlit old stone wall, the product sharp in the foreground, the face softly blurred behind it. Warm Mediterranean afternoon light, authentic premium social ad look." },
  { id: "tpl-desert-coat", style: "pp-fullbody", title: "Desert",
    prompt: "Full-body fashion editorial photo: {model} walks across pale desert sand dunes and carries {product}, which is clearly visible. Low golden sun, long shadows, warm sand and camel palette, high-end magazine campaign style." },
  { id: "tpl-gallery-pose", style: "pp-fullbody", title: "Gallery",
    prompt: "Full-body fashion editorial photo: {model} poses in an empty white art gallery next to a large abstract sculpture and presents {product}, which is clearly visible. Soft skylight from above, clean white and charcoal palette, high-end magazine campaign style." },
  { id: "tpl-ad-berry-claim", style: "ad-claim", title: "Berry claim",
    prompt: "A social media ad for {product}: the product large in the centre on a deep berry purple background, a few fresh berries around its base. {headline} Bold modern ad layout, strong contrast, glossy studio light, ready to post." },
  { id: "tpl-ad-mono-claim", style: "ad-claim", title: "Monochrome claim",
    prompt: "A premium social media ad for {product}: the product large in the centre on a matte black background, a single sharp spotlight from above. {headline} Minimal luxury ad layout, elegant white type, deep contrast." },
  { id: "tpl-ad-callouts-shoe", style: "ad-callouts", title: "Running shoe features",
    prompt: "A product feature ad for {product}: the product in the centre on a soft light blue background, thin white lines point from it to three short callouts with simple line icons. {headline} Sporty clean infographic ad style, precise and premium." },
  { id: "tpl-ad-callouts-serum", style: "ad-callouts", title: "Serum ingredients",
    prompt: "A product feature ad for {product}: the product in the centre on a warm beige background with a few fresh botanical ingredients, thin dark lines point to three short callouts. {headline} Clean beauty infographic ad style, soft light." },
  { id: "tpl-ad-split-clean", style: "ad-split", title: "Before / after cleaning",
    prompt: "A before and after ad for {product}: the image is split vertically, the left half shows a dirty stained surface labelled \"BEFORE\", the right half the same surface spotless and shiny labelled \"AFTER\", with the product in front. {headline} Clean direct-response ad style." },
  { id: "tpl-ad-split-hair", style: "ad-split", title: "Before / after hair",
    prompt: "A before and after ad for {product}: the image is split vertically, the left half shows dull frizzy hair labelled \"BEFORE\", the right half smooth glossy hair labelled \"AFTER\", with the product in front. {headline} Clean beauty direct-response ad style." },
  { id: "tpl-ad-sale-black", style: "ad-sale", title: "Black week",
    prompt: "A vertical sale ad for {product}: the product on a black background with glowing gold accents and a large gold starburst badge. {headline} Premium sale promotion style, bold gold typography, crisp studio light." },
  { id: "tpl-ad-sale-summer", style: "ad-sale", title: "Summer sale",
    prompt: "A vertical sale ad for {product}: the product on a sunny yellow to turquoise gradient with palm leaf shadows and a large starburst badge. {headline} Playful summer promotion style, bold typography, bright light." },
  { id: "tpl-ad-review-stars", style: "ad-review", title: "Five stars",
    prompt: "A social proof ad for {product}: the product on a soft cream background next to a rounded white review card with five gold stars and a short quote. {headline} Trustworthy, clean and friendly ad style, soft light." },
  { id: "tpl-ad-review-chat", style: "ad-review", title: "Chat review",
    prompt: "A social proof ad for {product}: the product on a soft pastel background next to two message bubbles from happy customers and five stars. {headline} Friendly, authentic social media ad style, soft light." },
  { id: "tpl-ad-review-ugc", style: "ad-review", title: "Customer photo",
    prompt: "A social proof ad for {product}: a casual customer photo of the product in use, overlaid with a rounded review card with five gold stars. {headline} Authentic, trustworthy ad style, natural light." },
  { id: "tpl-po-swiss-blue", style: "po-swiss", title: "Swiss blue",
    prompt: "A typographic poster in Swiss international style for {product}: strict grid, the product photo cut out on the right, huge bold sans-serif type stacked on the left. {headline} Cobalt blue, black and white palette, printed poster look." },
  { id: "tpl-po-swiss-orange", style: "po-swiss", title: "Swiss orange",
    prompt: "A typographic poster in Swiss international style for {product}: strict grid, the product photo centred in a circle, bold sans-serif type and small columns of fine body copy around it. {headline} Orange, black and off-white palette, printed poster look." },
  { id: "tpl-po-riso-green", style: "po-riso", title: "Riso green",
    prompt: "A risograph print poster for {product}: grainy two-colour print in fluorescent green and blue, slightly misaligned layers, the product as a halftone illustration surrounded by leaves. {headline} Indie zine poster style." },
  { id: "tpl-po-riso-gig", style: "po-riso", title: "Riso gig",
    prompt: "A risograph print poster for {product}: grainy two-colour print in orange and purple, slightly misaligned layers, the product as a bold halftone illustration with hand-drawn stars. {headline} Indie gig poster style." },
  { id: "tpl-po-collage-retro", style: "po-collage", title: "Retro collage",
    prompt: "A retro cut-paper collage poster for {product}: vintage magazine cut-outs, torn halftone paper and coloured tape around the product in the centre. {headline} 70s colours, tactile paper texture, editorial poster style." },
  { id: "tpl-po-collage-flower", style: "po-collage", title: "Flower collage",
    prompt: "A cut-paper collage poster for {product}: pressed flowers, torn pastel paper and handwritten notes around the product in the centre. {headline} Soft spring colours, tactile paper texture, editorial poster style." },
  { id: "tpl-po-neon-arcade", style: "po-neon", title: "Arcade",
    prompt: "A night-time poster for {product}: the product in front of glowing arcade machines, purple and electric blue neon light. {headline} Retro synthwave poster style, deep contrast." },
  { id: "tpl-po-neon-tokyo", style: "po-neon", title: "Rainy night",
    prompt: "A night-time poster for {product}: the product on a rainy city street with red and teal neon signs blurred behind it and reflections on the wet ground. {headline} Moody cinematic poster style." },
  { id: "tpl-po-minimal-cream", style: "po-minimal", title: "Cream",
    prompt: "A minimal editorial poster for {product}: the product small and centred on a large cream field, one thin line of elegant serif type below it. {headline} Quiet luxury style, soft shadow, generous margins." },
  { id: "tpl-po-minimal-black", style: "po-minimal", title: "Night black",
    prompt: "A minimal editorial poster for {product}: the product small and centred on a large deep black field with a single soft light, one thin line of elegant white serif type below it. {headline} Quiet luxury style, generous margins." },
  { id: "tpl-po-minimal-sage", style: "po-minimal", title: "Sage",
    prompt: "A minimal editorial poster for {product}: the product small and centred on a large muted sage green field, one thin line of elegant serif type below it. {headline} Calm natural luxury style, soft shadow, generous margins." },
  { id: "tpl-mk-white-sneaker", style: "mk-white", title: "Sneaker on white" },
  { id: "tpl-mk-white-bag", style: "mk-white", title: "Bag on white" },
  { id: "tpl-mk-benefits-blender", style: "mk-benefits", title: "Blender benefits" },
  { id: "tpl-mk-benefits-pillow", style: "mk-benefits", title: "Pillow benefits" },
  { id: "tpl-mk-dim-bottle", style: "mk-dimensions", title: "Bottle dimensions" },
  { id: "tpl-mk-dim-lamp", style: "mk-dimensions", title: "Lamp dimensions" },
  { id: "tpl-mk-dim-backpack", style: "mk-dimensions", title: "Backpack dimensions" },
  { id: "tpl-mk-inuse-kitchen", style: "mk-lifestyle", title: "In the kitchen",
    prompt: "A marketplace lifestyle image of {product}, shown in use on a tidy kitchen counter with fresh ingredients around it. Natural daylight, realistic scale, the product clearly in focus. Clean e-commerce gallery style." },
  { id: "tpl-mk-inuse-desk", style: "mk-lifestyle", title: "At the desk",
    prompt: "A marketplace lifestyle image of {product}, shown in use on a calm, tidy home office desk with a laptop and a plant. Natural daylight, realistic scale, the product clearly in focus. Clean e-commerce gallery style." },
  { id: "tpl-mk-box-earbuds", style: "mk-contents", title: "Earbuds set" },
  { id: "tpl-mk-box-skincare", style: "mk-contents", title: "Skincare set" },
  { id: "tpl-mk-box-coffee", style: "mk-contents", title: "Coffee set" },
  { id: "tpl-mo-orbit-gold", style: "mo-orbit", title: "Gold orbit",
    prompt: "{product} floats above a polished gold surface and slowly rotates. Camera: a smooth 180 degree orbit around the product. Warm golden rim light, soft reflections below it. Luxury commercial look. Sound: a slow, rich cinematic music bed." },
  { id: "tpl-mo-orbit-ice", style: "mo-orbit", title: "Ice orbit",
    prompt: "{product} floats in a cold blue studio among slowly drifting ice crystals and rotates. Camera: a smooth 180 degree orbit around the product. Cool blue rim light, frosty mist. Fresh premium commercial look. Sound: a crisp, airy electronic music bed." },
  { id: "tpl-mo-splash-milk", style: "mo-splash", title: "Milk splash",
    prompt: "{product} drops into creamy white milk in slow motion and a smooth crown splash rises around it. Camera: static close-up, then a gentle push in. Soft high-key studio light, clean commercial style. Sound: a soft liquid splash and a light music sting." },
  { id: "tpl-mo-splash-ocean", style: "mo-splash", title: "Ocean splash",
    prompt: "{product} plunges into turquoise sea water in slow motion, bubbles and a spray of droplets burst around it. Camera: static close-up at the water line, then a gentle push in. Bright summer sunlight, fresh commercial style. Sound: a deep splash and an upbeat summer music sting." },
  { id: "tpl-mo-kinetic-bold", style: "mo-kinetic", title: "Bold pop",
    prompt: "{product} stands in the centre of a hot pink background while bold yellow shapes and short words pop, slide and spin around it in rhythm, 2D motion graphics style. Camera: static, with quick punchy zooms on the beat. Even flat light. Sound: an energetic pop beat with whooshes." },
  { id: "tpl-mo-kinetic-mono", style: "mo-kinetic", title: "Mono type",
    prompt: "{product} stands in the centre of an off-white background while large black words slide in and out around it in a strict rhythm, minimal 2D motion graphics style. Camera: static, with crisp cuts on the beat. Even flat light. Sound: a minimal techno beat with clicks." },
  { id: "tpl-mo-collage-garden", style: "mo-collage", title: "Paper garden",
    prompt: "{product} sits in a hand-made paper garden: paper leaves, butterflies and cut-out suns unfold and flutter around it in stop-motion style. Camera: slow push in. Warm soft light, tactile craft look. Sound: paper rustles and a light acoustic melody." },
  { id: "tpl-mo-collage-space", style: "mo-collage", title: "Paper space",
    prompt: "{product} floats in a hand-made paper space scene: cut-out planets, paper rockets and glitter stars drift around it in stop-motion style. Camera: slow push in. Soft playful light, tactile craft look. Sound: paper rustles and a dreamy synth melody." },
  { id: "tpl-mo-ambient-bath", style: "mo-ambient", title: "Bathroom calm",
    prompt: "{product} rests on the edge of a stone bathtub while soft steam rises and warm sunlight slowly moves across the tiles. Camera: very slow dolly in. Calm natural light. Sound: gentle water drips and soft ambient piano." },
  { id: "tpl-mo-ambient-desk", style: "mo-ambient", title: "Evening light",
    prompt: "{product} stands on a wooden desk by a window at sunset, warm light and the shadows of plants drift slowly across it. Camera: very slow dolly in. Golden evening light. Sound: distant birds and a soft ambient guitar." },
  { id: "tpl-mo-explode-citrus", style: "mo-explode", title: "Citrus swirl",
    prompt: "Orange and lemon slices, mint leaves and fine droplets burst out and swirl in the air around {product}, then settle. Camera: static close-up in slow motion with a slight push in. Crisp studio light, vibrant commercial look. Sound: a soft burst and airy whooshes over light music." },
  { id: "tpl-mo-explode-cocoa", style: "mo-explode", title: "Cocoa swirl",
    prompt: "Cocoa beans, chocolate shards, hazelnuts and fine cocoa powder burst out and swirl around {product}, then settle. Camera: static close-up in slow motion with a slight push in. Warm studio light, rich indulgent commercial look. Sound: a soft burst and deep whooshes over warm music." },
  { id: "tpl-mo-explode-berry", style: "mo-explode", title: "Berry swirl",
    prompt: "Strawberries, blueberries, raspberries and splashes of yoghurt burst out and swirl around {product}, then settle. Camera: static close-up in slow motion with a slight push in. Bright studio light, fresh vibrant commercial look. Sound: a soft burst and playful whooshes over light music." },
  { id: "tpl-ugc-selfie-car", style: "ugc-selfie-review", title: "In the car",
    frame: "Authentic smartphone selfie photo in a parked car: the person from image 2 sits in the driver's seat and holds the product from image 1 up next to their face, smiling, the front of the product clearly visible. Soft daylight through the windshield, casual creator look, photorealistic.",
    prompt: "Handheld selfie shot in a parked car, medium close-up. The person in the image holds the product toward the camera, smiles and talks about it with natural lip movement. Soft daylight through the windshield, authentic social media look, photorealistic. The person says enthusiastically: {line} Ambient noise: a quiet car interior." },
  { id: "tpl-ugc-selfie-cafe", style: "ugc-selfie-review", title: "At the café",
    frame: "Authentic smartphone selfie photo in a cosy café: the person from image 2 holds the product from image 1 up next to their face and smiles at the camera, the front of the product clearly visible. Warm window light, casual creator look, photorealistic.",
    prompt: "Handheld selfie shot in a cosy café, medium close-up. The person in the image holds the product toward the camera, smiles and recommends it with natural lip movement. Warm window light, authentic social media look, photorealistic. The person says warmly: {line} Ambient noise: soft café chatter and cups clinking." },
  { id: "tpl-ugc-unbox-sofa", style: "ugc-unboxing", title: "On the sofa",
    frame: "Candid photo on a sofa: the person from image 2 lifts the product from image 1 out of an open plain cardboard box on their lap and looks thrilled, the product clearly visible. Soft afternoon light, authentic home video look, photorealistic.",
    prompt: "Static medium close-up on a sofa. The person in the image lifts the product out of the box on their lap, looks thrilled and turns to the camera, speaking with natural lip movement. Soft afternoon light, authentic home video look, photorealistic. The person says excitedly: {line} SFX: rustling paper and cardboard. Ambient noise: a quiet living room." },
  { id: "tpl-ugc-unbox-door", style: "ugc-unboxing", title: "Parcel arrived",
    frame: "Candid photo in a bright hallway: the person from image 2 has just opened a parcel and holds the product from image 1 up toward the camera with a big smile, the product clearly visible. Daylight, authentic home video look, photorealistic.",
    prompt: "Handheld medium shot in a bright hallway. The person in the image holds up the product from the just opened parcel, grins and tells the camera about it with natural lip movement. Daylight, authentic home video look, photorealistic. The person says happily: {line} SFX: tape ripping off cardboard. Ambient noise: a quiet hallway." },
  { id: "tpl-ugc-howto-kitchen", style: "ugc-tutorial", title: "Kitchen tip",
    frame: "Photo at a kitchen counter: the person from image 2 shows the product from image 1 to the camera with one hand, ingredients beside them, friendly and calm, the product clearly visible. Bright daylight, clean creator look, photorealistic.",
    prompt: "Static medium shot at a kitchen counter. The person in the image shows the product to the camera and explains how to use it, calm and friendly, with natural lip movement and small hand gestures. Bright daylight, clean social media look, photorealistic. The person says calmly: {line} Ambient noise: a soft kitchen room tone." },
  { id: "tpl-ugc-howto-gym", style: "ugc-tutorial", title: "Gym tip",
    frame: "Photo in a bright gym: the person from image 2 in sportswear shows the product from image 1 to the camera with one hand, friendly and energetic, the product clearly visible. Clean daylight, authentic creator look, photorealistic.",
    prompt: "Handheld medium shot in a bright gym. The person in the image shows the product to the camera and explains how they use it, friendly and energetic, with natural lip movement and small gestures. Clean daylight, authentic social media look, photorealistic. The person says with energy: {line} Ambient noise: a quiet gym with distant weights." },
  { id: "tpl-ugc-street-park", style: "ugc-street", title: "In the park",
    frame: "Photo in a green city park: the person from image 2 holds the product from image 1 next to their face and smiles at the camera, the product clearly visible. Soft afternoon sun through trees, authentic creator look, photorealistic.",
    prompt: "Handheld walking shot in a green city park, medium close-up. The person in the image walks toward the camera, stops, raises the product next to their face and recommends it with natural lip movement. Soft afternoon sun through the trees, authentic creator look, photorealistic. The person says cheerfully: {line} Ambient noise: birds and distant voices in a park." },
  { id: "tpl-ugc-street-bike", style: "ugc-street", title: "By bike",
    frame: "Street photo: the person from image 2 stands next to a city bike on a sunny street and holds the product from image 1 up toward the camera, smiling, the product clearly visible. Golden afternoon light, authentic creator look, photorealistic.",
    prompt: "Handheld medium shot on a sunny street. The person in the image stands next to a city bike, raises the product toward the camera and recommends it with energy and natural lip movement. Golden afternoon light, authentic creator look, photorealistic. The person says with energy: {line} Ambient noise: a bicycle bell and light street sounds." },
  { id: "tpl-ugc-grwm-vanity", style: "ugc-grwm", title: "Vanity",
    frame: "Photo at a vanity table with a ring light: the person from image 2 holds the product from image 1 while getting ready in the morning, smiling at the camera, the product clearly visible. Warm soft light, cosy creator look, photorealistic.",
    prompt: "Static medium close-up at a vanity table with a ring light. The person in the image uses the product while getting ready and talks to the camera like to a friend, with natural lip movement. Warm soft light, cosy creator look, photorealistic. The person says in a relaxed voice: {line} Music: a soft lo-fi beat in the background." },
  { id: "tpl-ugc-grwm-mirror", style: "ugc-grwm", title: "Before going out",
    frame: "Photo in front of a bedroom mirror in the evening: the person from image 2 holds the product from image 1 while getting ready to go out, smiling at the camera, the product clearly visible. Warm lamp light, cosy creator look, photorealistic.",
    prompt: "Static medium close-up in front of a bedroom mirror in the evening. The person in the image uses the product while getting ready to go out and talks to the camera like to a friend, with natural lip movement. Warm lamp light, cosy creator look, photorealistic. The person says playfully: {line} Music: a soft upbeat R&B track in the background." },
  { id: "tpl-ugc-grwm-bath", style: "ugc-grwm", title: "Morning routine",
    frame: "Photo at a bright bathroom sink in the morning: the person from image 2 with a headband holds the product from image 1 during their skincare routine, smiling at the camera, the product clearly visible. Fresh soft light, cosy creator look, photorealistic.",
    prompt: "Static medium close-up at a bright bathroom sink. The person in the image uses the product during their morning skincare routine and talks to the camera like to a friend, with natural lip movement. Fresh soft light, cosy creator look, photorealistic. The person says in a relaxed voice: {line} Music: a soft acoustic beat in the background." },
];

export const MS_STYLES: MsStyle[] = [
  // UGC: step 1 `frame` (Seedream: product = image 1, avatar = image 2), step 2 `prompt` (Veo, prompt-veo: audio at the end, no quote marks).
  {
    id: "ugc-selfie-review", category: "ugc", flow: "ugc", title: "Selfie review", aspect: "9:16", badge: "top",
    wishHint: "e.g. This has been my favourite serum for weeks",
    frame: "Authentic smartphone selfie photo: the person from image 2 holds the product from image 1 up next to their face in a bright bedroom, smiling at the camera, the front of the product clearly visible. Natural window light, casual creator look, photorealistic.",
    prompt: "Handheld selfie shot, medium close-up. The person in the image holds the product toward the camera, smiles and talks about it with natural lip movement, then tilts it so the front is visible. Natural window light, authentic social media look, photorealistic. The person says warmly: {line} Ambient noise: a quiet bedroom.",
  },
  {
    id: "ugc-unboxing", category: "ugc", flow: "ugc", title: "Unboxing", aspect: "9:16",
    wishHint: "e.g. It's finally here, look at this",
    frame: "Candid photo at a kitchen table: the person from image 2 lifts the product from image 1 out of an open plain cardboard box and looks delighted, the product clearly visible. Soft daylight, authentic home video look, photorealistic.",
    prompt: "Static medium close-up at a kitchen table. The person in the image lifts the product out of the box, looks at it delighted and turns to the camera, speaking with natural lip movement. Soft daylight, authentic home video look, photorealistic. The person says excitedly: {line} SFX: rustling cardboard. Ambient noise: a quiet kitchen.",
  },
  {
    id: "ugc-tutorial", category: "ugc", flow: "ugc", title: "How-to", aspect: "9:16",
    wishHint: "e.g. Two drops are enough, just massage it in",
    frame: "Photo at a bathroom mirror: the person from image 2 shows the product from image 1 to the camera with one hand, friendly and calm, the product clearly visible. Bright soft light, clean creator look, photorealistic.",
    prompt: "Slow push in, medium close-up at a bathroom mirror. The person in the image shows the product to the camera and explains how to use it, calm and friendly, with natural lip movement and small hand gestures. Bright soft light, clean social media look, photorealistic. The person says calmly: {line} Ambient noise: a soft bathroom room tone.",
  },
  {
    id: "ugc-street", category: "ugc", flow: "ugc", title: "On the go", aspect: "9:16", badge: "neu",
    wishHint: "e.g. Fits in any bag, I always have it with me",
    frame: "Street photo on a sunny city sidewalk: the person from image 2 holds the product from image 1 next to their face and smiles at the camera, the product clearly visible. Golden afternoon light, authentic creator look, photorealistic.",
    prompt: "Handheld walking shot on a sunny city street, medium close-up. The person in the image walks toward the camera, stops, raises the product next to their face and recommends it with energy and natural lip movement. Golden afternoon light, authentic creator look, photorealistic. The person says with energy: {line} Ambient noise: light street sounds and distant traffic.",
  },
  {
    id: "ugc-grwm", category: "ugc", flow: "ugc", title: "Get ready with me", aspect: "9:16",
    wishHint: "e.g. My trick to make it last all day",
    frame: "Photo at a vanity table with a ring light: the person from image 2 holds the product from image 1 while getting ready in the morning, smiling at the camera, the product clearly visible. Warm soft light, cosy creator look, photorealistic.",
    prompt: "Static medium close-up at a vanity table with a ring light. The person in the image uses the product while getting ready and talks to the camera like to a friend, with natural lip movement. Warm soft light, cosy creator look, photorealistic. The person says in a relaxed voice: {line} Music: a soft lo-fi beat in the background.",
  },

  // Product shots: the product is image 1, grouped as in the style picker.
  {
    id: "ps-plinth", category: "product", flow: "product_shots", group: "Closeup", title: "Studio plinth", aspect: "3:4", badge: "top",
    wishHint: "e.g. on light travertine",
    prompt: "Clean editorial product photography of {product}, standing on a matte stone plinth in a calm studio. Soft directional light from the left, a gentle long shadow, warm neutral backdrop. Premium commercial look, shallow depth of field, the packaging sharp in every detail.",
  },
  {
    id: "ps-droplets", category: "product", flow: "product_shots", group: "Closeup", title: "Fresh droplets", aspect: "3:4",
    wishHint: "e.g. with limes",
    prompt: "Macro product photography of {product}, covered in fine fresh water droplets, with a few ice crystals around its base on a wet dark surface. Crisp backlight makes the droplets sparkle. Fresh, cool beverage commercial style, high detail.",
  },
  {
    id: "ps-shadows", category: "product", flow: "product_shots", group: "Editorial", title: "Shadow play", aspect: "4:3",
    wishHint: "e.g. with palm shadows",
    prompt: "Editorial still life of {product} on a sunlit plaster surface, hard late afternoon sun casting striped shadows from window blinds across it. Warm sand and terracotta palette, minimal composition with generous empty space, magazine campaign style.",
  },
  {
    id: "ps-pastel", category: "product", flow: "product_shots", group: "Editorial", title: "Pastel set", aspect: "1:1", badge: "neu",
    wishHint: "e.g. in mint green",
    prompt: "Playful set design product photo of {product}, placed among simple pastel geometric shapes, a cylinder, an arch and a sphere, on a seamless pastel backdrop. Soft even light, gentle shadows, colourful modern brand campaign style.",
  },
  {
    id: "ps-nature", category: "product", flow: "product_shots", group: "Editorial", title: "Nature", aspect: "3:4",
    wishHint: "e.g. by a mountain lake",
    prompt: "Outdoor product photo of {product}, resting on a mossy rock beside a clear forest stream, ferns and soft morning mist in the background. Dappled sunlight, natural green palette, organic premium brand style, the product in sharp focus.",
  },

  // Product shots with a model: the product is image 1, the avatar (if any) image 2.
  {
    id: "pp-hand", category: "product", flow: "product_shots_people", group: "With model", title: "In hand", aspect: "3:4",
    model: "a person with natural, well-kept hands and a light linen shirt",
    wishHint: "e.g. in front of a stone wall",
    prompt: "Close-up lifestyle photo: {model} holds {product} toward the camera with one hand, the product sharp in the foreground, the face softly out of focus behind it. Bright natural daylight, soft neutral background, authentic premium social ad look.",
  },
  {
    id: "pp-lifestyle", category: "product", flow: "product_shots_people", group: "With model", title: "Lifestyle", aspect: "4:3", badge: "top",
    model: "a young woman with a warm smile and casual clothes",
    wishHint: "e.g. on a balcony",
    prompt: "Lifestyle photo in a bright modern apartment: {model} uses {product} at a sunlit wooden table, relaxed and smiling. Warm morning light, soft focus background with plants, natural candid brand campaign style.",
  },
  {
    id: "pp-fullbody", category: "product", flow: "product_shots_people", group: "Full body", title: "Full-body editorial", aspect: "2:3",
    model: "a tall fashion model with a confident pose",
    wishHint: "e.g. in a desert landscape",
    prompt: "Full-body fashion editorial photo: {model} stands in a minimal concrete space and presents {product}, which is clearly visible. Strong side light, crisp shadows, muted neutral palette, high-end magazine campaign style.",
  },

  // Ads: the product is image 1, an ad reference (if any) the next image.
  {
    id: "ad-claim", category: "ads", flow: "ads", title: "Big claim", aspect: "3:4", badge: "top",
    wishHint: "Headline, e.g. Fresher than ever",
    prompt: "A social media ad for {product}: the product large in the centre on a bold solid colour background that matches its packaging. {headline} Clean modern ad layout, strong contrast, studio light, ready to post.",
  },
  {
    id: "ad-callouts", category: "ads", flow: "ads", title: "Feature callouts", aspect: "1:1",
    wishHint: "Three benefits, e.g. Vegan, 24h hold, Fragrance-free",
    prompt: "A product feature ad for {product}: the product in the centre on a light background, thin lines point from it to three short callouts with simple icons. {headline} Clean infographic ad style, precise and premium.",
  },
  {
    id: "ad-split", category: "ads", flow: "ads", title: "Before / after", aspect: "1:1",
    wishHint: "e.g. Dull skin before, glowing after",
    prompt: "A before and after ad for {product}: the image is split vertically, the left half dull and grey labelled \"BEFORE\", the right half bright and vibrant labelled \"AFTER\" with the product in front. {headline} Clean direct-response ad style.",
  },
  {
    id: "ad-sale", category: "ads", flow: "ads", title: "Sale", aspect: "9:16", badge: "neu",
    wishHint: "Offer, e.g. -30% this weekend only",
    prompt: "A vertical sale ad for {product}: the product on a vivid gradient background with a large starburst badge. {headline} Energetic retail promotion style, bold typography, crisp studio light.",
  },
  {
    id: "ad-review", category: "ads", flow: "ads", title: "Customer review", aspect: "3:4",
    wishHint: "Quote, e.g. Best shampoo I ever had",
    prompt: "A social proof ad for {product}: the product on a soft neutral background next to a rounded review card with five gold stars. {headline} Trustworthy, clean and friendly ad style, soft light.",
  },

  // Posters: product photo or a description; the format is the style's.
  {
    id: "po-swiss", category: "posters", flow: "poster", title: "Swiss grid", aspect: "2:3", badge: "top",
    wishHint: "e.g. Summer edition 2026",
    prompt: "A typographic poster in Swiss international style for {product}: strict grid, the product photo in the lower half, large bold sans-serif type across the top. {headline} Red, black and off-white palette, lots of white space, printed poster look.",
  },
  {
    id: "po-riso", category: "posters", flow: "poster", title: "Risograph", aspect: "3:4",
    wishHint: "e.g. New flavour: mango",
    prompt: "A risograph print poster for {product}: grainy two-colour print in fluorescent pink and teal, slightly misaligned layers, the product as a halftone illustration in the centre. {headline} Indie zine poster style.",
  },
  {
    id: "po-collage", category: "posters", flow: "poster", title: "Collage", aspect: "2:3", badge: "neu",
    wishHint: "e.g. Festival special",
    prompt: "A cut-paper collage poster for {product}: torn paper shapes, tape and magazine cut-outs around the product in the centre, playful hand-made layout. {headline} Bright mixed colours, tactile paper texture, editorial poster style.",
  },
  {
    id: "po-neon", category: "posters", flow: "poster", title: "Neon night", aspect: "2:3",
    wishHint: "e.g. Late Night Edition",
    prompt: "A night-time poster for {product}: the product on a wet reflective street at night, pink and blue neon light glowing around it. {headline} Moody cinematic poster style, deep contrast.",
  },
  {
    id: "po-minimal", category: "posters", flow: "poster", title: "Minimal", aspect: "3:4",
    wishHint: "e.g. Less is more",
    prompt: "A minimal editorial poster for {product}: the product small and centred on a large calm off-white field, one thin line of elegant serif type below it. {headline} Quiet luxury style, soft shadow, generous margins.",
  },

  // Marketplace: shop images, format fixed per style.
  {
    id: "mk-white", category: "marketplace", flow: "marketplace", title: "Main image white", aspect: "1:1", badge: "top",
    prompt: "A marketplace main product image of {product}: the product alone, centred and filling most of the frame, on a pure white background (#FFFFFF), with a soft natural shadow below it. Even studio light, true colours, sharp details, e-commerce catalogue style.",
  },
  {
    id: "mk-benefits", category: "marketplace", flow: "marketplace", title: "Benefits infographic", aspect: "1:1",
    wishHint: "Benefits, e.g. Waterproof, 2-year warranty, Recycled",
    prompt: "A marketplace infographic image for {product}: the product on the left on a light background, on the right three benefit rows, each with a simple line icon and one or two words. {headline} Clean e-commerce listing style, consistent spacing.",
  },
  {
    id: "mk-dimensions", category: "marketplace", flow: "marketplace", title: "Dimensions", aspect: "1:1",
    wishHint: "Dimensions, e.g. 12 cm high, 6 cm wide",
    prompt: "A marketplace dimensions image of {product}: the product centred on a white background, thin measurement lines with arrows along its height and width. {headline} Precise technical e-commerce style, neutral grey lines.",
  },
  {
    id: "mk-lifestyle", category: "marketplace", flow: "marketplace", title: "In use", aspect: "1:1", badge: "neu",
    wishHint: "e.g. in the bathroom",
    prompt: "A marketplace lifestyle image of {product}, shown in use in a bright, tidy home setting that fits the product. Natural daylight, realistic scale, the product clearly in focus. Clean e-commerce gallery style.",
  },
  {
    id: "mk-contents", category: "marketplace", flow: "marketplace", title: "What's in the box", aspect: "1:1",
    wishHint: "Contents, e.g. Bottle, pump, travel pouch",
    prompt: "A marketplace image showing what is in the box: {product} and its accessories laid out neatly in a flat lay on a light grey background, evenly spaced. {headline} Clean e-commerce catalogue style, soft top light.",
  },

  // Motion: the product photo is the start frame (Kling). Prompts follow prompt-kling: subject, action, scene, camera, light, sound.
  {
    id: "mo-orbit", category: "motion", flow: "motion", title: "Product orbit", aspect: "16:9", badge: "top",
    wishHint: "e.g. on glossy black",
    prompt: "{product} floats in the centre of a dark studio and slowly rotates. Camera: a smooth 180 degree orbit around the product. Soft rim light traces its edges, tiny dust particles glow in the air. Premium commercial look. Sound: a deep, slow cinematic music bed.",
  },
  {
    id: "mo-splash", category: "motion", flow: "motion", title: "Splash", aspect: "9:16", badge: "neu",
    wishHint: "e.g. with orange juice",
    prompt: "{product} drops into a pool of clear liquid in slow motion and a crown of splashing droplets bursts around it. Camera: static close-up, then a gentle push in. Bright high-key studio light, fresh commercial style. Sound: a crisp liquid splash and an upbeat music sting.",
  },
  {
    id: "mo-kinetic", category: "motion", flow: "motion", title: "Kinetic type", aspect: "9:16",
    wishHint: "Words, e.g. New. Fresh. Now.",
    prompt: "{product} stands in the centre of a flat colour background while bold graphic shapes and short words slide, pop and bounce around it in rhythm, 2D motion graphics style. Camera: static, with quick punchy zooms on the beat. Even flat light. Sound: an energetic electronic beat with whooshes.",
  },
  {
    id: "mo-collage", category: "motion", flow: "motion", title: "Paper collage", aspect: "1:1",
    wishHint: "e.g. with flowers",
    prompt: "{product} sits in a hand-made paper collage world: torn paper flowers, tape and cut-out stars unfold and flutter around it in stop-motion style. Camera: slow push in. Warm soft light, tactile craft look. Sound: paper rustles and a playful ukulele melody.",
  },
  {
    id: "mo-ambient", category: "motion", flow: "motion", title: "Ambient light", aspect: "16:9",
    wishHint: "e.g. in morning light",
    prompt: "{product} rests on a stone surface while soft sunlight and leaf shadows drift slowly across it, a light breeze moves a sheer curtain in the background. Camera: very slow dolly in. Calm natural light. Sound: gentle wind and soft ambient piano.",
  },
  {
    id: "mo-explode", category: "motion", flow: "motion", title: "Ingredient swirl", aspect: "9:16",
    wishHint: "e.g. strawberries and mint",
    prompt: "Fresh ingredients burst out and swirl in the air around {product}: fruit slices, leaves and fine droplets orbit it, then settle. Camera: static close-up in slow motion with a slight push in. Crisp studio light, vibrant commercial look. Sound: a soft burst and airy whooshes over light music.",
  },
];

export type MsInputs = {
  product?: string;
  avatar?: string;
  adReference?: string;
  wish?: string;
  aspect?: string;
  duration?: number;
};

export type MsError =
  | "unknown_style" | "style_unavailable" | "product_image_required" | "avatar_required" | "avatar_not_supported"
  | "ad_reference_not_supported" | "poster_content_required" | "aspect_ratio_invalid" | "duration_invalid" | "line_required";
/** UGC's second step, known when step 1 starts: what animates the still once it is done. */
export type MsNext = { jobType: string; duration: number; aspect: string; line: string };
export type MsJob = { ok: true; jobType: string; params: Record<string, unknown>; style: MsStyle; next?: MsNext } | { ok: false; error: MsError };

export const WISH_MAX = 200;
/** A spoken UGC line fits about 10 seconds of speech. */
export const LINE_MAX = 160;

/** A style or a template (resolved to its base style with its own prompt, format and cover). */
export function findStyle(id: string): MsStyle | undefined {
  const style = MS_STYLES.find((s) => s.id === id);
  if (style) return style;
  const t = MS_TEMPLATES.find((x) => x.id === id);
  const base = t && MS_STYLES.find((s) => s.id === t.style);
  if (!t || !base) return undefined;
  return {
    ...base, id: t.id, title: t.title, base: base.id, cover: cover(t.id), coverShape: COVER_SHAPE[t.id] ?? "2:3",
    prompt: t.prompt ?? base.prompt, frame: t.frame ?? base.frame, aspect: t.aspect ?? base.aspect, badge: t.badge,
  };
}

/** The style picker shows each style with the cover of its first template. */
export function styleCover(styleId: string): string | undefined {
  const t = MS_TEMPLATES.find((x) => x.style === styleId);
  return t ? cover(t.id) : undefined;
}

/** A style runs when the register has its flow's model (UGC: both models of the chain). */
export function styleAvailable(style: MsStyle, has: (jobType: string) => boolean): boolean {
  const r = FLOWS[style.flow];
  return has(r.jobType) && (!r.frameJobType || has(r.frameJobType));
}

const clean = (s: string | undefined, max: number) => s?.trim().replace(/\s+/g, " ").slice(0, max) || undefined;
/** Quote marks inside quoted text would end the quote early (prompt-seedream: exact wording in double quotes). */
const unquote = (s: string) => s.replace(/["“”„«»]/g, "").trim();

/**
 * Builds the job for one style (for UGC: its first step, with `next`). The register validates the result like any
 * job. `has` tells which job types the register offers today.
 */
export function composeMarketingJob(styleId: string, inputs: MsInputs, has: (jobType: string) => boolean): MsJob {
  const style = findStyle(styleId);
  if (!style) return { ok: false, error: "unknown_style" };
  const rules = FLOWS[style.flow];
  if (!styleAvailable(style, has)) return { ok: false, error: "style_unavailable" };

  const wish = clean(inputs.wish, style.flow === "ugc" ? LINE_MAX : WISH_MAX);
  if (rules.product === "required" && !inputs.product) return { ok: false, error: "product_image_required" };
  if (rules.avatar === "required" && !inputs.avatar) return { ok: false, error: "avatar_required" };
  if (rules.avatar === "none" && inputs.avatar) return { ok: false, error: "avatar_not_supported" };
  if (!rules.adReference && inputs.adReference) return { ok: false, error: "ad_reference_not_supported" };
  if (style.flow === "poster" && !inputs.product && !wish) return { ok: false, error: "poster_content_required" };
  if (style.flow === "motion" && !inputs.product && !wish) return { ok: false, error: "product_image_required" };
  if (style.flow === "ugc" && !wish) return { ok: false, error: "line_required" };

  let aspect = style.aspect;
  if (inputs.aspect !== undefined && inputs.aspect !== style.aspect) {
    if (!rules.aspects.includes(inputs.aspect)) return { ok: false, error: "aspect_ratio_invalid" };
    aspect = inputs.aspect;
  }

  let duration: number | undefined;
  if (rules.duration) {
    duration = inputs.duration ?? rules.duration.default;
    const d = rules.duration;
    if (!Number.isInteger(duration) || duration < d.min || duration > d.max || (d.steps && !d.steps.includes(duration))) return { ok: false, error: "duration_invalid" };
  } else if (inputs.duration !== undefined) {
    return { ok: false, error: "duration_invalid" };
  }

  if (rules.kind === "image") return imageJob(style, rules, inputs, wish, aspect);
  if (style.flow === "motion") return motionJob(style, rules, inputs, wish, aspect, duration!);
  return ugcJob(style, rules, inputs, wish!, aspect, duration!);
}

function imageJob(style: MsStyle, rules: FlowRules, inputs: MsInputs, wish: string | undefined, aspect: string): MsJob {
  const references: string[] = [];
  let product: string;
  // Posters may start from a description alone; then the wish is the product and is not added again.
  let wishUsed = false;
  if (inputs.product) {
    references.push(inputs.product);
    product = `the product from image ${references.length}`;
  } else {
    product = `the product described as "${unquote(wish!)}"`;
    wishUsed = true;
  }
  let model = style.model ?? "a model";
  if (inputs.avatar) {
    references.push(inputs.avatar);
    model = `the person from image ${references.length}`;
  }
  // Text styles (ads, posters, infographics) set the wish as their lettering; the others take it as a scene wish.
  const textStyle = style.prompt.includes("{headline}");
  const headline = textStyle && wish && !wishUsed ? `Lettering in a bold clean typeface: "${unquote(wish)}".` : "";
  if (textStyle && wish && !wishUsed) wishUsed = true;
  let prompt = style.prompt.replaceAll("{product}", product).replaceAll("{model}", model).replace("{headline}", headline);
  prompt = prompt.replace(/\s{2,}/g, " ").trim();
  if (inputs.adReference) {
    references.push(inputs.adReference);
    prompt += ` Take only the layout, colour palette and mood from image ${references.length}, not its product or its wording.`;
  }
  if (wish && !wishUsed) prompt += ` Additional wish: ${wish}`;
  return { ok: true, jobType: rules.jobType, style, params: { prompt, aspect_ratio: aspect, resolution: "2K", references } };
}

function motionJob(style: MsStyle, rules: FlowRules, inputs: MsInputs, wish: string | undefined, aspect: string, duration: number): MsJob {
  let prompt: string;
  if (inputs.product) {
    prompt = style.prompt.replaceAll("{product}", "The product from the image");
    if (wish) prompt += ` Additional wish: ${wish}`;
  } else {
    prompt = style.prompt.replaceAll("{product}", `The product, ${unquote(wish!)},`);
  }
  // Kling starts the sentence with the placeholder; keep the capital only at the very start.
  prompt = prompt.replace(/([a-z,] )The product/g, "$1the product");
  return {
    ok: true, jobType: rules.jobType, style,
    params: { prompt, ...(inputs.product ? { image: inputs.product } : {}), duration, aspect_ratio: aspect, generate_audio: true },
  };
}

/** UGC step 1: the still of the avatar holding the product. Step 2 follows with composeUgcVideo once it is done. */
function ugcJob(style: MsStyle, rules: FlowRules, inputs: MsInputs, line: string, aspect: string, duration: number): MsJob {
  return {
    ok: true, jobType: rules.frameJobType!, style,
    params: { prompt: style.frame!, aspect_ratio: aspect, resolution: "2K", references: [inputs.product!, inputs.avatar!] },
    next: { jobType: rules.jobType, duration, aspect, line },
  };
}

/** A spoken line for Veo: no quote marks (prompt-veo: quoted text can appear on screen), ends with a full stop. */
function spokenLine(line: string): string {
  const spoken = unquote(line);
  return /[.!?…]$/.test(spoken) ? spoken : `${spoken}.`;
}

/**
 * UGC step 2: the finished still (copied into the caller's uploads) speaks the line. Same checks as step 1 for
 * line, length and format, so a client cannot change the deal between the two steps beyond what step 1 allowed.
 */
export function composeUgcVideo(
  styleId: string, inputs: { frame?: string; wish?: string; duration?: number; aspect?: string }, has: (jobType: string) => boolean,
): MsJob {
  const style = findStyle(styleId);
  if (!style || style.flow !== "ugc") return { ok: false, error: "unknown_style" };
  if (!styleAvailable(style, has)) return { ok: false, error: "style_unavailable" };
  const rules = FLOWS.ugc;
  if (!inputs.frame) return { ok: false, error: "product_image_required" };
  const line = clean(inputs.wish, LINE_MAX);
  if (!line) return { ok: false, error: "line_required" };
  const aspect = inputs.aspect ?? style.aspect;
  if (!rules.aspects.includes(aspect)) return { ok: false, error: "aspect_ratio_invalid" };
  const duration = inputs.duration ?? rules.duration!.default;
  if (!rules.duration!.steps!.includes(duration)) return { ok: false, error: "duration_invalid" };
  const prompt = style.prompt.replace("{line}", spokenLine(line));
  return {
    ok: true, jobType: rules.jobType, style,
    params: { prompt, image: inputs.frame, duration, resolution: "720p", aspect_ratio: aspect, generate_audio: true },
  };
}

/** What the browser may see: no prompt, no model route. */
export function publicStyle(s: MsStyle, has: (jobType: string) => boolean) {
  const rules = FLOWS[s.flow];
  return {
    id: s.id, category: s.category, flow: s.flow, kind: rules.kind, title: s.title, group: s.group ?? null,
    aspect: s.aspect, aspects: rules.aspects, batch: rules.batch, duration: rules.duration ?? null,
    product: rules.product, avatar: rules.avatar, adReference: rules.adReference,
    wishHint: s.wishHint ?? null, badge: s.badge ?? null, available: styleAvailable(s, has),
    cover: s.cover ?? styleCover(s.id) ?? null, base: s.base ?? null, coverShape: s.coverShape ?? "2:3",
    lettering: s.prompt.includes("{headline}"), spoken: s.flow === "ugc", chain: Boolean(rules.frameJobType),
  };
}

export type PublicMsStyle = ReturnType<typeof publicStyle>;

/** What a run was started with (own uploads and settings), kept on its jobs so it can be repeated or adjusted. */
export type MsRunInputs = { product?: string; avatar?: string; adReference?: string; aspect?: string; duration?: number; count?: number };

/**
 * The job tag: views show the Marketing Agent style, the wish and the run's inputs, never the prompt. The inputs are
 * the caller's own uploads and settings only; "Again" and "Adjust" start from them again.
 */
export function msRecipeTag(style: MsStyle, wish?: string, inputs: MsRunInputs = {}) {
  const w = clean(wish, WISH_MAX);
  const run = Object.fromEntries(Object.entries(inputs).filter(([, v]) => v !== undefined && v !== ""));
  return { id: `ms:${style.id}`, title: `Marketing Agent · ${style.title}`, ...(w ? { wish: w } : {}), ...(Object.keys(run).length ? { inputs: run as MsRunInputs } : {}) };
}

/** Templates for the wall, resolved (no prompt). */
export function publicTemplates(has: (jobType: string) => boolean) {
  return MS_TEMPLATES.flatMap((t) => {
    const s = findStyle(t.id);
    return s ? [publicStyle(s, has)] : [];
  });
}
