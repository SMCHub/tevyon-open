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

/** Purchase routes and router ids (comfy, kling/…, anthropic/…). Model names such as «Claude Opus 5.5» stay. */
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

const COUNT_WORD: Record<string, number> = { zwei: 2, drei: 3, vier: 4, "2": 2, "3": 3, "4": 4 };
const NUMBER_WORD = ["", "", "zwei", "drei", "vier"];
/** Plural noun → the singular with its article, for a text that announced several but shows one. */
const ONE: Record<string, string> = {
  Ideen: "eine Idee", Vorschläge: "einen Vorschlag", Varianten: "eine Variante", Optionen: "eine Option", Wege: "einen Weg",
  Clips: "einen Clip", Bilder: "ein Bild", Videos: "ein Video", Creatives: "ein Creative", Konzepte: "ein Konzept", Looks: "einen Look",
};
const COUNTED = new RegExp(`(?<![\\p{L}\\d])(zwei|drei|vier|[234])(\\s+)((?:\\p{L}+e\\s+)?)(${Object.keys(ONE).join("|")})(?![\\p{L}])`, "giu");

/**
 * The model writes its text before it calls the tools, so «drei Ideen» can stand above two cards when a call is missing
 * or refused. Sets the number of announced ideas, proposals or creatives to the `shown` ones (1 to 4); otherwise as is.
 */
export function matchCount(text: string, shown: number): string {
  if (shown < 1 || shown > 4) return text;
  return text.replace(COUNTED, (all, num: string, space: string, adjective: string, noun: string) => {
    const said = COUNT_WORD[num.toLowerCase()];
    if (said === undefined || said === shown) return all;
    const upper = num[0] !== num[0]!.toLowerCase();
    const cap = (s: string) => (upper ? s[0]!.toUpperCase() + s.slice(1) : s);
    const key = Object.keys(ONE).find((k) => k.toLowerCase() === noun.toLowerCase()) ?? noun;
    if (shown === 1) return cap(ONE[key] ?? `${num} ${noun}`);
    return `${/\d/.test(num) ? String(shown) : cap(NUMBER_WORD[shown]!)}${space}${adjective}${noun}`;
  });
}
