/**
 * Recipes ("Presets" on the website): one click, one photo, a finished clip.
 * A recipe fixes model, format, duration, sound and the prompt; the user only adds a photo
 * and optionally a short wish. The prompt is our know-how and never leaves the server.
 */
import type { Register } from "./register";

export type RecipeCategory = "effects" | "viral" | "ads";

export type Recipe = {
  id: string;
  title: string;
  tagline: string;
  category: RecipeCategory;
  /** What the user has to bring: a photo of a person, a product (or dish) or a place (room, house, venue). */
  needs: "photo" | "product" | "place";
  jobType: string;
  params: Record<string, unknown>;
  prompt: string;
  preview: { video: string; poster: string };
  badge?: "neu" | "top";
  /** Placeholder of the optional wish field, a hint at what fits this preset. */
  wishHint?: string;
  /**
   * The wish becomes a spoken line (talking photo, voiceover). Then it is required, cleaned of quote marks
   * (prompt-veo: quoted text can appear on screen) and set into the prompt at {line}.
   */
  line?: { label: string; placeholder: string };
};

const VIRAL_CLIP = { duration: 4, resolution: "720p", aspect_ratio: "9:16", generate_audio: true } as const;
/** Longer clips for presets people pay for: a spoken line or a product story needs 6 to 8 seconds. */
const CLIP_6 = { ...VIRAL_CLIP, duration: 6 } as const;
const CLIP_8 = { ...VIRAL_CLIP, duration: 8 } as const;
const WISH_MAX = 200;
/** A spoken line fits about 8 seconds of speech. */
const LINE_MAX = 120;

const preview = (id: string) => ({ video: `/presets/${id}.mp4`, poster: `/presets/${id}.webp` });

export const RECIPES: Recipe[] = [
  {
    id: "say-it",
    title: "Say it!",
    tagline: "Your photo speaks your line, lip-synced",
    category: "viral",
    needs: "photo",
    badge: "top",
    jobType: "veo_3_1_lite",
    params: CLIP_8,
    line: { label: "What should be said?", placeholder: "Happy birthday, Lena!" },
    prompt: "Medium close-up portrait, gentle handheld push in. The person in the image looks straight into the camera, smiles and speaks with natural lip movement and lively facial expressions. Soft warm window light, shallow depth of field, photorealistic. The person says warmly: {line} Ambient noise: a quiet room tone.",
    preview: preview("say-it"),
  },
  {
    id: "voiceover-ad",
    title: "Ad with voiceover",
    tagline: "Your product, your slogan, spoken like a TV spot",
    category: "ads",
    needs: "product",
    badge: "top",
    jobType: "veo_3_1_lite",
    params: CLIP_8,
    line: { label: "Your slogan", placeholder: "Freshly roasted. Every morning." },
    prompt: "Slow dolly in, close-up. The product in the image stands on a clean surface while a soft beam of light glides across it and reveals its details, premium commercial look, shallow depth of field, photorealistic. A warm, confident voiceover says: {line} Music: a calm, modern electronic beat.",
    preview: preview("voiceover-ad"),
  },
];

/** The presets people see and can pick. */
export const LISTED_RECIPES: Recipe[] = RECIPES;

/**
 * Drafts: written to the prompt skill of their model and tested like live recipes (preset-skills.test.ts), but
 * not shown or startable yet. A draft moves into RECIPES once its preview (public/presets/<id>.mp4 and .webp)
 * exists; a test keeps every live recipe honest about that.
 */
export const DRAFT_RECIPES: Recipe[] = [
  {
    id: "splash",
    title: "Splash shot",
    tagline: "Your product dives into water, in slow motion",
    category: "ads",
    needs: "product",
    badge: "neu",
    jobType: "veo_3_1_lite",
    params: VIRAL_CLIP,
    wishHint: "e.g. into milk instead of water",
    prompt: "Close-up, slow motion. The product in the image drops into crystal-clear water and a crown of splashing droplets bursts around it, bright studio light, fresh and clean commercial look, photorealistic. SFX: a crisp water splash.",
    preview: preview("splash"),
  },
  {
    id: "ingredients",
    title: "Ingredient burst",
    tagline: "Fresh ingredients fly around your product",
    category: "ads",
    needs: "product",
    jobType: "veo_3_1_lite",
    params: CLIP_6,
    wishHint: "e.g. strawberries and mint",
    prompt: "Static close-up, slow motion. Fresh ingredients burst out around the product in the image and float in the air: fruit slices, green leaves, water droplets and fine powder, crisp studio light, vibrant commercial look, photorealistic. SFX: a soft burst and gentle whooshes.",
    preview: preview("ingredients"),
  },
  {
    id: "lifestyle",
    title: "Lifestyle scene",
    tagline: "From packshot to a real home",
    category: "ads",
    needs: "product",
    jobType: "veo_3_1_lite",
    params: CLIP_6,
    wishHint: "e.g. in the bathroom instead of the kitchen",
    prompt: "Slow pull back, medium shot. The product in the image stands on a sunlit wooden table in a cozy modern kitchen in the morning, a coffee cup and fresh flowers beside it, warm natural light, lifestyle commercial look, photorealistic. Ambient noise: soft morning birdsong and a quiet kitchen.",
    preview: preview("lifestyle"),
  },
  {
    id: "food-hero",
    title: "Food hero",
    tagline: "Your dish steams and shines like in a commercial",
    category: "ads",
    needs: "product",
    jobType: "veo_3_1_lite",
    params: CLIP_6,
    wishHint: "e.g. with stretchy melted cheese",
    prompt: "Slow push in, close-up. The dish in the image sits on a rustic wooden table, gentle steam rises from it and a glossy sauce drizzles over the top, warm restaurant light, shallow depth of field, appetizing food commercial, photorealistic. SFX: a soft sizzle. Ambient noise: a calm restaurant murmur.",
    preview: preview("food-hero"),
  },
  {
    id: "room-tour",
    title: "Room tour",
    tagline: "One photo of a flat becomes a camera move",
    category: "ads",
    needs: "place",
    badge: "neu",
    jobType: "veo_3_1_lite",
    params: CLIP_8,
    wishHint: "e.g. in the evening with warm light",
    prompt: "Smooth gimbal shot, slow dolly forward at eye level. The camera glides gently into the room in the image, sunlight moves softly across the floor and furniture, bright and inviting, real estate showcase look, photorealistic. Ambient noise: a quiet bright room, faint birdsong outside.",
    preview: preview("room-tour"),
  },
];

export type RecipeError = "unknown_recipe" | "image_required" | "line_required";
export type RecipeJob = { ok: true; jobType: string; params: Record<string, unknown> } | { ok: false; error: RecipeError };

export function findRecipe(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

/** Builds the job for a preset. Validation of the result happens in the register like for any job. */
export function buildRecipeJob(id: string, inputs: { image?: string; wish?: string }): RecipeJob {
  const recipe = findRecipe(id);
  if (!recipe) return { ok: false, error: "unknown_recipe" };
  return composeRecipeJob(recipe, inputs);
}

/** The job of one recipe, live or draft (drafts are composed only by tests). */
export function composeRecipeJob(recipe: Recipe, inputs: { image?: string; wish?: string }): RecipeJob {
  if (!inputs.image) return { ok: false, error: "image_required" };
  const wish = inputs.wish?.trim().replace(/\s+/g, " ");
  let prompt: string;
  if (recipe.line) {
    const line = wish?.replace(/["“”„«»]/g, "").trim().slice(0, LINE_MAX);
    if (!line) return { ok: false, error: "line_required" };
    prompt = recipe.prompt.replace("{line}", /[.!?…]$/.test(line) ? line : `${line}.`);
  } else {
    const extra = wish?.slice(0, WISH_MAX);
    prompt = extra ? `${recipe.prompt} Additional wish: ${extra}` : recipe.prompt;
  }
  return { ok: true, jobType: recipe.jobType, params: { ...recipe.params, prompt, image: inputs.image } };
}

/** What the browser may see: no prompt, no route. */
export function publicRecipe(r: Recipe) {
  return {
    id: r.id, title: r.title, tagline: r.tagline, category: r.category, needs: r.needs, badge: r.badge ?? null, preview: r.preview,
    wishHint: r.wishHint ?? null, line: r.line ?? null,
  };
}

export type ResolvedModel = { ok: true; jobType: string } | { ok: false; reason: "unknown" };

/** Which model a preset runs on: its job type, as long as the register has it. */
export function resolveRecipeModel(jobType: string, register: Pick<Register, "get">): ResolvedModel {
  return register.get(jobType) ? { ok: true, jobType } : { ok: false, reason: "unknown" };
}
