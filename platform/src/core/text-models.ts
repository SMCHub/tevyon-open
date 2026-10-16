import { creditsFromComfy } from "./pricing";
/**
 * The language models behind the Director: strong models that take tools and see images, reached through the Comfy
 * Router's chat route (server/comfy.ts). Model names are public; the route slug and the list price stay on the server.
 */
export type TextTier = "beste" | "ausgewogen" | "schnell";

export type TextModelDef = {
  /** Tachyon's own id, safe for clients. */
  id: string;
  name: string;
  maker: string;
  tier: TextTier;
  /** One German line for the model picker. */
  tagline: string;
  /** Understands attached photos. */
  vision: boolean;
  default?: true;
  /** Server-only: the model name on the router's chat route. */
  route: { provider: "comfy"; slug: string };
  /** Server-only: list price in USD per million tokens, as of `approved`. */
  price: { inputPerM: number; outputPerM: number; approved: string };
};

export type PublicTextModel = Pick<TextModelDef, "id" | "name" | "maker" | "tier" | "tagline" | "vision"> & {
  default: boolean;
  /** 1 (cheap) to 4 (expensive): how fast a turn uses the daily Director budget. */
  cost: 1 | 2 | 3 | 4;
  /** Messages cost credits (the strongest models) instead of the free daily budget. */
  paid: boolean;
  /** Paid models: credits for a typical message and the most one can cost (held while it runs). */
  credits?: { typical: number; cap: number };
};

const APPROVED = "2026-10-13";
const or = (slug: string) => ({ provider: "comfy" as const, slug });

export const TEXT_MODELS: TextModelDef[] = [
  {
    id: "claude-fable-5-1", name: "Claude Fable 5.1", maker: "Anthropic", tier: "beste", vision: true,
    tagline: "Das stärkste Modell: Storyboards, genaue Prompts, durchdachte Ideen",
    route: or("anthropic/claude-fable-5.1"), price: { inputPerM: 10, outputPerM: 50, approved: APPROVED },
  },
  {
    id: "claude-opus-5-5", name: "Claude Opus 5.5", maker: "Anthropic", tier: "beste", vision: true,
    tagline: "Sehr stark und schneller als Fable",
    route: or("anthropic/claude-opus-5.5"), price: { inputPerM: 4, outputPerM: 20, approved: APPROVED },
  },
  {
    id: "gpt-6-astra", name: "GPT-6 Astra", maker: "OpenAI", tier: "beste", vision: true,
    tagline: "OpenAIs Spitzenmodell für anspruchsvolle Konzepte",
    route: or("openai/gpt-6-astra"), price: { inputPerM: 10, outputPerM: 50, approved: APPROVED },
  },
  {
    id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", maker: "Anthropic", tier: "ausgewogen", vision: true, default: true,
    tagline: "Kreativ, schnell und zuverlässig: der Standard",
    route: or("anthropic/claude-sonnet-5.5"), price: { inputPerM: 2, outputPerM: 10, approved: APPROVED },
  },
  {
    id: "gpt-6-1-sol", name: "GPT-6.1 Sol", maker: "OpenAI", tier: "ausgewogen", vision: true,
    tagline: "OpenAIs Allrounder für Ideen und Prompts",
    route: or("openai/gpt-6.1-sol"), price: { inputPerM: 2, outputPerM: 10, approved: APPROVED },
  },
  {
    id: "gemini-3-1-pro", name: "Gemini 3.1 Pro", maker: "Google", tier: "ausgewogen", vision: true,
    tagline: "Stark beim Verstehen von Fotos und langen Briefings",
    route: or("google/gemini-3.1-pro-preview"), price: { inputPerM: 2, outputPerM: 12, approved: APPROVED },
  },
  {
    id: "grok-4-7", name: "Grok 4.7", maker: "xAI", tier: "ausgewogen", vision: true,
    tagline: "Frech und direkt, gut für schräge virale Ideen",
    route: or("x-ai/grok-4.7"), price: { inputPerM: 2, outputPerM: 6, approved: APPROVED },
  },
  {
    id: "claude-haiku-5-5", name: "Claude Haiku 5.5", maker: "Anthropic", tier: "schnell", vision: true,
    tagline: "Blitzschnell für kurze Rückfragen",
    route: or("anthropic/claude-haiku-5.5"), price: { inputPerM: 0.1, outputPerM: 0.5, approved: APPROVED },
  },
  {
    id: "gpt-6-luna", name: "GPT-6 Luna", maker: "OpenAI", tier: "schnell", vision: true,
    tagline: "Schnell und sparsam",
    route: or("openai/gpt-6-luna"), price: { inputPerM: 0.1, outputPerM: 0.5, approved: APPROVED },
  },
  {
    id: "gemini-3-8-flash", name: "Gemini 3.8 Flash", maker: "Google", tier: "schnell", vision: true,
    tagline: "Schnell mit gutem Blick für Fotos",
    route: or("google/gemini-3.8-flash"), price: { inputPerM: 0.75, outputPerM: 3.75, approved: APPROVED },
  },
];

const byId = new Map(TEXT_MODELS.map((m) => [m.id, m]));

export function textModel(id: string): TextModelDef | undefined {
  return byId.get(id);
}

export function defaultTextModel(): TextModelDef {
  return TEXT_MODELS.find((m) => m.default)!;
}

export function turnCostUsd(m: TextModelDef, tokens: { input: number; output: number }): number {
  return (tokens.input * m.price.inputPerM + tokens.output * m.price.outputPerM) / 1e6;
}

/** A typical Director turn: system prompt with presets and models, some history, one answer with proposals. */
export const TYPICAL_TURN = { input: 4_000, output: 600 } as const;

/**
 * The longest turn the Director lets happen: system prompt and tools (about 1,500 tokens), history capped at 12,000
 * characters, one photo (up to about 2,500 tokens), the message, and at most 1,500 output tokens for the strongest
 * models (max_tokens in director-llm.ts, reasoning included). It bounds what a paid message can cost.
 */
export const MAX_TURN = { input: 8_000, output: 1_500 } as const;

/** The strongest models cost credits per message; the others run on the free daily budget. */
export const isPaid = (m: TextModelDef) => m.tier === "beste";

/**
 * What one Comfy credit is worth in USD, to price chat turns (billed in USD per token) in credits like media jobs.
 * platform.comfy.org billing page (16.10.2026): «You pay 1 USD for 211 credits». USD_PER_COMFY_CREDIT overrides it.
 */
export const USD_PER_COMFY_CREDIT: number = (() => {
  const raw = Number(globalThis.process?.env?.USD_PER_COMFY_CREDIT);
  return Number.isFinite(raw) && raw > 0 ? raw : 1 / 211;
})();

const creditsForUsd = (usd: number) => creditsFromComfy(usd / USD_PER_COMFY_CREDIT);

/** Credits for a paid message: what the turn cost, at least 1 and at most the cap. */
export function settleCredits(m: TextModelDef, costUsd: number): number {
  const cap = creditsForUsd(turnCostUsd(m, MAX_TURN));
  return Math.min(cap, Math.max(1, creditsForUsd(costUsd)));
}

/** What a paid message costs: typically, and at most (shown before sending and held while the turn runs). */
export function messageCredits(m: TextModelDef): { typical: number; cap: number } {
  return { typical: settleCredits(m, turnCostUsd(m, TYPICAL_TURN)), cap: creditsForUsd(turnCostUsd(m, MAX_TURN)) };
}

function costClass(usd: number): PublicTextModel["cost"] {
  if (usd < 0.006) return 1;
  if (usd < 0.02) return 2;
  if (usd < 0.05) return 3;
  return 4;
}

export function publicTextModels(): PublicTextModel[] {
  return TEXT_MODELS.map((m) => ({
    id: m.id, name: m.name, maker: m.maker, tier: m.tier, tagline: m.tagline, vision: m.vision,
    default: Boolean(m.default), cost: costClass(turnCostUsd(m, TYPICAL_TURN)), paid: isPaid(m),
    ...(isPaid(m) ? { credits: messageCredits(m) } : {}),
  }));
}
