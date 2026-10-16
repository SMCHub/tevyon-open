/**
 * Streaming pieces of the Director: the language model's OpenAI-compatible event stream (server-sent events) turned
 * into plain events, and a sanitizer that keeps the purchase route out of the text users see, even when a name arrives
 * split across two deltas.
 */
export type ToolCall = { name: string; args: Record<string, unknown> };

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; costUsd?: number; inputTokens?: number; outputTokens?: number };

type Chunk = {
  error?: { message?: string; code?: number | string };
  choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

/**
 * Reads `data:` lines until `data: [DONE]`. Keepalive comments (`: …`) and reasoning deltas are ignored. Tool calls
 * arrive as fragments keyed by index; their arguments are joined and parsed at the end (invalid JSON drops the call).
 * The usage chunk (sent with `usage: { include: true }`) carries the real cost.
 */
export async function* parseChatStream(lines: AsyncIterable<string>): AsyncGenerator<ModelEvent> {
  const calls = new Map<number, { name: string; args: string }>();
  let usage: Extract<ModelEvent, { type: "usage" }> | undefined;

  for await (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    let chunk: Chunk;
    try {
      chunk = JSON.parse(data) as Chunk;
    } catch {
      continue;
    }
    if (chunk.error) throw new Error(`model stream error: ${chunk.error.message ?? chunk.error.code ?? "unknown"}`);
    const delta = chunk.choices?.[0]?.delta;
    if (typeof delta?.content === "string" && delta.content) yield { type: "text", delta: delta.content };
    for (const tc of delta?.tool_calls ?? []) {
      const i = tc.index ?? 0;
      const cur = calls.get(i) ?? { name: "", args: "" };
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      calls.set(i, cur);
    }
    if (chunk.usage) {
      usage = {
        type: "usage",
        ...(typeof chunk.usage.cost === "number" ? { costUsd: chunk.usage.cost } : {}),
        ...(typeof chunk.usage.prompt_tokens === "number" ? { inputTokens: chunk.usage.prompt_tokens } : {}),
        ...(typeof chunk.usage.completion_tokens === "number" ? { outputTokens: chunk.usage.completion_tokens } : {}),
      };
    }
  }

  for (const [, c] of [...calls].sort(([a], [b]) => a - b)) {
    if (!c.name) continue;
    try {
      const args: unknown = c.args ? JSON.parse(c.args) : {};
      if (args && typeof args === "object" && !Array.isArray(args)) yield { type: "tool_call", call: { name: c.name, args: args as Record<string, unknown> } };
    } catch {
      // A broken call is dropped; the turn still shows the text and the other proposals.
    }
  }
  if (usage) yield usage;
}

/** Purchase routes and router ids (comfy, kling/…, anthropic/…). Model names such as "Claude Opus 5.5" stay. */
const ROUTE =
  /\b(?:comfy(?:ui)?(?: router)?|openrouter|fal\.ai|fal ai|byok)\b|\b(?:bfl|kling|ltx|veo|vertexai|bytedance(?:-seed)?|google|kwaivgi|alibaba|anthropic|openai|x-ai|deepseek|qwen|moonshotai|z-ai|mistralai|meta-llama|black-forest-labs|minimax)\/[\w.:-]*/gi;
/** Longest stretch held back, so a name split across deltas is complete before it is checked. */
const TAIL = 40;

/** Removes purchase routes and vendor ids from finished text (proposals, the last piece of a stream). */
export const scrubRoute = (s: string) => s.replace(ROUTE, "").replace(/\(\s*\)/g, "").replace(/ {2,}/g, " ");
const clean = scrubRoute;

/**
 * Cleans streamed text. It releases text only up to the last space before the held-back tail, so a word or id is
 * never cut in two: whatever is still growing at the end stays in the buffer until it is complete.
 */
export function createStreamSanitizer() {
  let buf = "";
  return {
    push(delta: string): string {
      buf += delta;
      if (buf.length <= TAIL) return "";
      const cut = buf.lastIndexOf(" ", buf.length - TAIL);
      if (cut <= 0) return "";
      const out = buf.slice(0, cut);
      buf = buf.slice(cut);
      return clean(out);
    },
    flush(): string {
      const out = clean(buf);
      buf = "";
      return out;
    },
  };
}

/** German and English count words: the Director answers in the user's language, English by default. */
const COUNT_WORD: Record<string, number> = { zwei: 2, drei: 3, vier: 4, two: 2, three: 3, four: 4, "2": 2, "3": 3, "4": 4 };
const NUMBER_WORD = { de: ["", "", "zwei", "drei", "vier"], en: ["", "", "two", "three", "four"] };
/** German plural noun → the singular with its article, for a text that announced several but shows one. */
const ONE_DE: Record<string, string> = {
  Ideen: "eine Idee", Vorschläge: "einen Vorschlag", Varianten: "eine Variante", Optionen: "eine Option", Wege: "einen Weg",
  Clips: "einen Clip", Bilder: "ein Bild", Videos: "ein Video", Creatives: "ein Creative", Konzepte: "ein Konzept", Looks: "einen Look",
};
/** English plural noun → its singular. */
const ONE_EN: Record<string, string> = {
  ideas: "idea", proposals: "proposal", suggestions: "suggestion", variations: "variation", variants: "variant", options: "option",
  ways: "way", clips: "clip", images: "image", videos: "video", creatives: "creative", concepts: "concept", looks: "look", shots: "shot",
};
const COUNTED_DE = new RegExp(`(?<![\\p{L}\\d-])(zwei|drei|vier|[234])(\\s+)((?:\\p{L}+e\\s+)?)(${Object.keys(ONE_DE).join("|")})(?![\\p{L}])`, "giu");
const COUNTED_EN = new RegExp(`(?<![\\p{L}\\d-])(two|three|four|[234])(\\s+)((?:\\p{L}+\\s+)?)(${Object.keys(ONE_EN).join("|")})(?![\\p{L}])`, "giu");

/** A German reply (otherwise the text is read as English). */
const GERMAN = /[äöüß]|\b(?:ich|und|der|die|das|ist|nicht|mit|für|dir|hier|sind|zwei|drei|vier|eine?n?)\b/i;

/**
 * The model writes its text before it calls the tools, so "three ideas" can stand above two cards when a call is
 * missing or refused. Sets the number of announced ideas, proposals or creatives to the `shown` ones (1 to 4), in
 * English or German; otherwise as is.
 */
export function matchCount(text: string, shown: number): string {
  if (shown < 1 || shown > 4) return text;
  const fix = (lang: "de" | "en") => (all: string, num: string, space: string, adjective: string, noun: string) => {
    const said = COUNT_WORD[num.toLowerCase()];
    if (said === undefined || said === shown) return all;
    const upper = num[0] !== num[0]!.toLowerCase();
    const cap = (s: string) => (upper ? s[0]!.toUpperCase() + s.slice(1) : s);
    if (shown === 1) {
      if (lang === "de") {
        const key = Object.keys(ONE_DE).find((k) => k.toLowerCase() === noun.toLowerCase()) ?? noun;
        return cap(ONE_DE[key] ?? `${num} ${noun}`);
      }
      const one = ONE_EN[noun.toLowerCase()] ?? noun;
      const sing = noun[0] !== noun[0]!.toLowerCase() ? one[0]!.toUpperCase() + one.slice(1) : one;
      return `${/\d/.test(num) ? "1" : cap("one")}${space}${adjective}${sing}`;
    }
    return `${/\d/.test(num) ? String(shown) : cap(NUMBER_WORD[lang][shown]!)}${space}${adjective}${noun}`;
  };
  return GERMAN.test(text) ? text.replace(COUNTED_DE, fix("de")) : text.replace(COUNTED_EN, fix("en"));
}
