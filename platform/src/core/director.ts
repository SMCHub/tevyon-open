import { catalog } from "./catalog";
import { createStreamSanitizer, matchCount, scrubRoute, type ModelEvent, type ToolCall } from "./director-stream";
import type { MarketingProposal } from "./marketing-agent";
import { LISTED_RECIPES, RECIPES } from "./recipes";

/**
 * Tevyon Director: a chat agent that turns a wish into two or three concrete, priced proposals.
 * It only proposes. Starting a job (and spending credits) is always the user's click.
 * The reply streams while the model writes; proposals follow once the model is done.
 */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };
export type { ToolCall } from "./director-stream";
/** The language model behind the Director as a stream of events, injected so tests run without network. */
export type ChatModel = (messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal) => AsyncIterable<ModelEvent>;
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type Proposal =
  | { type: "preset"; presetId: string; title: string; why: string; wish?: string; credits: number | null }
  | { type: "custom"; jobType: string; kind: "image" | "video"; model: string; prompt: string; params: Record<string, unknown>; why: string; credits: number | null }
  | MarketingProposal;

/**
 * Who answers a turn: the system prompt, the tools the model may call and how a call becomes a checked, priced
 * proposal. The Director is the default; the Marketing Agent (marketing-agent.ts) plans campaigns with the same
 * streaming, budget and sanitizing.
 */
export type AgentSpec = {
  system(hasPhoto: boolean, seesPhoto: boolean): string;
  tools: ToolSpec[];
  propose(call: ToolCall): Proposal | null;
  /** Most proposals one turn shows. */
  max: number;
  /** Reply when the model wrote no text: with proposals, and without. */
  fallback: { proposals: string; empty: string };
};

export type DirectorTurn = { reply: string; proposals: Proposal[]; suggestions: string[]; costUsd: number | null };

/**
 * What the Director streams: text while it is written, then the proposals, the replies the user can tap next (only
 * when there are any), the real cost of the turn, the full reply.
 */
export type DirectorEvent =
  | { type: "text"; delta: string }
  | { type: "proposals"; proposals: Proposal[] }
  | { type: "suggestions"; suggestions: string[] }
  | { type: "usage"; costUsd: number | null }
  | { type: "done"; reply: string };

const MAX_PROPOSALS = 3;
const SUGGEST_REPLIES = "suggest_replies";
const MAX_REPLIES = 3;
const MAX_REPLY_CHARS = 60;

/**
 * Replies to tap next (shown under every answer): short, whole, at most three. One that
 * names a purchase route is dropped, not scrubbed, because a scrubbed reply would read wrong.
 */
function toReplies(v: unknown): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(v) ? v : []) {
    if (typeof r !== "string") continue;
    const s = r.replace(/\s+/g, " ").trim();
    if (!s || s.length > MAX_REPLY_CHARS || scrubRoute(s) !== s || out.includes(s)) continue;
    out.push(s);
    if (out.length === MAX_REPLIES) break;
  }
  return out;
}

export const DIRECTOR_TOOLS: ToolSpec[] = [
  {
    name: "propose_preset",
    description: "Propose one of Tevyon's one-click presets. Best when the user has a photo and wants something viral fast.",
    parameters: {
      type: "object",
      properties: {
        preset_id: { type: "string", description: "Preset id from the list" },
        wish: { type: "string", description: "Optional short extra wish for the preset, max 200 characters, English" },
        why: { type: "string", description: "One short sentence in the user's language (English by default) on why this works" },
      },
      required: ["preset_id", "why"],
    },
  },
  {
    name: "propose_custom",
    description: "Propose a custom generation with a model from the catalog and a ready prompt (English, concrete: subject, action, camera, light).",
    parameters: {
      type: "object",
      properties: {
        job_type: { type: "string", description: "Job type from the catalog" },
        prompt: { type: "string", description: "The full prompt in English" },
        aspect_ratio: { type: "string", description: "e.g. 9:16 for TikTok/Reels, 16:9 for YouTube; the one your text names" },
        duration: { type: "number", description: "Video length in seconds, only for video models" },
        why: { type: "string", description: "One short sentence in the user's language (English by default) on why this works" },
      },
      required: ["job_type", "prompt", "aspect_ratio", "why"],
    },
  },
  {
    name: SUGGEST_REPLIES,
    description: "2 or 3 short replies the user can tap next, in the user's language (English by default), worded as the user would type them. Call it once, last.",
    parameters: {
      type: "object",
      properties: {
        replies: { type: "array", items: { type: "string" }, description: "Each at most 60 characters" },
      },
      required: ["replies"],
    },
  },
];

function systemPrompt(hasPhoto: boolean, seesPhoto: boolean): string {
  const presets = LISTED_RECIPES.map((r) => `- ${r.id}: ${r.title} – ${r.tagline} (needs ${r.needs === "photo" ? "a photo" : r.needs === "product" ? "a product photo" : "a room photo"})`).join("\n");
  // Job types that need files without a default cannot be proposed from a chat: they stay out.
  const models = catalog.list().filter((d) => !d.sample).map((d) => `- ${d.jobType}: ${d.model} (${d.kind === "video" ? "video" : "image"}) – ${d.tagline}`).join("\n");
  return `You are the Tevyon Director, an AI director for viral short videos and images (TikTok, Reels, Shorts, ads). You propose; the user starts a job with a click.
Language: always reply in the language of the user's last message (German stays German, French stays French); if it is unclear, reply in English. The same goes for why and suggest_replies.
How you talk: first person, present tense, calm and concrete, without praise ("Great idea!"), filler or exclamation marks. At most 3 short sentences.
Your first sentence says what you make of the wish: subject, format and look, e.g. "I'm turning your dog into a portrait clip: he jumps through a portal." Seconds and models are on the cards, not in the text. After that at most one sentence (what you see in the photo, what you do differently, or one question).
Always text first, then the tools. The cards appear under your text on their own: no "Here are my ideas". Never state how many proposals you make, the text is written before the cards. why: what the result shows and why it works, one sentence.
Concrete wish (topic, product, idea or photo): 2 to 3 clearly different proposals via propose_preset or propose_custom. Without a concrete wish (greeting, small talk, "help me") no proposals: greet briefly and ask in one sentence what should be made and what for. Otherwise at most one question, only when needed.
Always finish with suggest_replies: after proposals, next steps ("Make it darker", "16:9 for YouTube instead"), after a question its most likely answers.
Your earlier proposals stand in square brackets after your replies; "started" ones the user ran: build on them instead of starting over.
Ads for a brand, a product or a campaign: make your proposals and mention once in the conversation, in half a sentence, the Marketing Agent (in the menu at the top), which plans whole campaigns with claim and caption from a product photo and a brief.
Regulated areas (gambling, alcohol, tobacco, financial products, health): no promises of winnings, returns or cures, nothing aimed at minors, a short note on the country's advertising rules (age limit, mandatory notices).
Virality: hook in the first second, surprising transformation, 9:16, short clips (4 to 6 s). Presets when a photo is there and one fits; without a photo custom generations with a finished English prompt. Mention a missing photo only when a preset needs one.
Real people in photos: kindly remind the user of their consent. No celebrities, no brands, nothing offensive. Only model names, never providers, routers, IDs or prices.
Photo attached: ${hasPhoto ? "yes" : "no"}${seesPhoto ? "\nYou can see the photo. Say in half a sentence what you see in it, and shape the proposals around it." : ""}

Presets:
${presets}

Models (job_type):
${models}`;
}

/** A non-empty string from the model's tool arguments, without purchase routes or vendor ids. */
function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? scrubRoute(v).trim() : "";
  return s || undefined;
}

function toProposal(call: ToolCall, quote: (jobType: string, params: Record<string, unknown>) => number | null): Proposal | null {
  if (call.name === "propose_preset") {
    const recipe = RECIPES.find((r) => r.id === str(call.args.preset_id));
    if (!recipe) return null;
    const wish = str(call.args.wish)?.slice(0, 200);
    return {
      type: "preset", presetId: recipe.id, title: recipe.title, why: str(call.args.why) ?? recipe.tagline,
      ...(wish ? { wish } : {}), credits: quote(recipe.jobType, { ...recipe.params, prompt: recipe.prompt }),
    };
  }
  if (call.name === "propose_custom") {
    const def = catalog.get(str(call.args.job_type) ?? "");
    const prompt = str(call.args.prompt);
    if (!def || !prompt) return null;
    const aspect = str(call.args.aspect_ratio);
    const duration = def.kind === "video" && typeof call.args.duration === "number" ? call.args.duration : undefined;
    // What the model asked for; a length the model does not offer keeps the format, anything else the model's defaults.
    const tries = [
      { prompt, ...(aspect ? { aspect_ratio: aspect } : {}), ...(duration !== undefined ? { duration } : {}) },
      ...(aspect && duration !== undefined ? [{ prompt, aspect_ratio: aspect }] : []),
      { prompt },
    ];
    const parsed = tries.map((t) => def.params.safeParse(t)).find((r) => r.success);
    if (!parsed?.success) return null;
    const params = parsed.data as Record<string, unknown>;
    return {
      type: "custom", jobType: def.jobType, kind: def.kind, model: def.model, prompt, params,
      why: str(call.args.why) ?? def.tagline, credits: quote(def.jobType, params),
    };
  }
  return null;
}

/** The Director: viral clips and images from presets or custom jobs. */
export function directorAgent(quote: TurnInput["quote"]): AgentSpec {
  return {
    system: systemPrompt, tools: DIRECTOR_TOOLS, propose: (call) => toProposal(call, quote), max: MAX_PROPOSALS,
    // Fast models sometimes call the tools without a word: then the Director still speaks in its voice.
    fallback: { proposals: "I turned your wish into proposals; nothing starts until you click.", empty: "What should we make, and what is it for?" },
  };
}

type TurnInput = {
  /** Default: the Director with `quote`. */
  agent?: AgentSpec;
  history: { role: "user" | "assistant"; content: string }[];
  hasPhoto: boolean;
  /** The attached photo as data URL, only for models that see images. */
  photo?: { dataUrl: string };
  model: ChatModel;
  quote: (jobType: string, params: Record<string, unknown>) => number | null;
  signal?: AbortSignal;
};

/** One Director turn as a stream: sanitized text while the model writes, then validated, priced proposals and the cost. */
export async function* streamDirectorTurn(input: TurnInput): AsyncGenerator<DirectorEvent> {
  const history: ChatMessage[] = input.history.slice(-20);
  const last = history.at(-1);
  if (input.photo && last?.role === "user" && typeof last.content === "string") {
    history[history.length - 1] = {
      role: "user",
      content: [{ type: "text", text: last.content }, { type: "image_url", image_url: { url: input.photo.dataUrl } }],
    };
  }
  const agent = input.agent ?? directorAgent(input.quote);
  const messages: ChatMessage[] = [{ role: "system", content: agent.system(input.hasPhoto, Boolean(input.photo)) }, ...history];

  const sanitizer = createStreamSanitizer();
  const calls: ToolCall[] = [];
  let suggestions: string[] = [];
  let reply = "";
  let costUsd: number | null = null;
  for await (const e of input.model(messages, agent.tools, input.signal)) {
    if (e.type === "text") {
      const out = sanitizer.push(e.delta);
      if (out) {
        reply += out;
        yield { type: "text", delta: out };
      }
    } else if (e.type === "tool_call") {
      // Replies only for an agent that offers the tool.
      if (e.call.name !== SUGGEST_REPLIES) calls.push(e.call);
      else if (!suggestions.length && agent.tools.some((t) => t.name === SUGGEST_REPLIES)) suggestions = toReplies(e.call.args.replies);
    } else if (e.costUsd !== undefined) {
      costUsd = e.costUsd;
    }
  }
  const rest = sanitizer.flush();
  if (rest) {
    reply += rest;
    yield { type: "text", delta: rest };
  }

  const proposals = calls
    .map((c) => agent.propose(c))
    .filter((p): p is Proposal => p !== null)
    .slice(0, agent.max);
  if (!reply.trim()) {
    reply = proposals.length ? agent.fallback.proposals : agent.fallback.empty;
    yield { type: "text", delta: reply };
  }
  yield { type: "proposals", proposals };
  if (suggestions.length) yield { type: "suggestions", suggestions };
  yield { type: "usage", costUsd };
  // The text came before the tool calls: the final reply names as many ideas as there are cards.
  yield { type: "done", reply: matchCount(reply.trim(), proposals.length) };
}

/** One Director turn, collected: for callers that do not stream (tests, MCP). */
export async function runDirectorTurn(input: TurnInput): Promise<DirectorTurn> {
  const turn: DirectorTurn = { reply: "", proposals: [], suggestions: [], costUsd: null };
  for await (const e of streamDirectorTurn(input)) {
    if (e.type === "proposals") turn.proposals = e.proposals;
    else if (e.type === "suggestions") turn.suggestions = e.suggestions;
    else if (e.type === "usage") turn.costUsd = e.costUsd;
    else if (e.type === "done") turn.reply = e.reply;
  }
  return turn;
}
