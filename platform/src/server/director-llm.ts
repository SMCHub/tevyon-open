import type { ChatModel } from "@/core/director";
import { parseChatStream } from "@/core/director-stream";
import type { TextModelDef } from "@/core/text-models";
import { chatUrl } from "./comfy";

/**
 * The Director's language model over the provider's OpenAI-compatible chat API, streamed (server-sent events).
 * Server-only: the vendor slug and the provider never reach a client; users see the model name only.
 * - `usage: { include: true }` reports the real cost in the last chunk (daily Director budget)
 * - `provider.data_collection: "deny"` keeps prompts and photos away from providers that train on them (terms “no training”)
 * - no temperature: several reasoning models reject it; reasoning effort is low, a little more for the strongest models
 */
export function createDirectorModel(opts: { apiKey: string; model: TextModelDef; fetch?: typeof fetch }): ChatModel {
  const doFetch = opts.fetch ?? fetch;
  const strong = opts.model.tier === "beste";
  return async function* (messages, tools, signal) {
    const timeout = AbortSignal.timeout(90_000);
    const res = await doFetch(chatUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model.route.slug,
        messages,
        tools: tools.map((t) => ({ type: "function", function: t })),
        tool_choice: "auto",
        // The strongest models bill per message: 1,500 output tokens (reasoning included) bound the cap (MAX_TURN).
        max_tokens: strong ? 1_500 : 1_400,
        reasoning: { effort: strong ? "medium" : "low" },
        stream: true,
        usage: { include: true },
        provider: { data_collection: "deny" },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok || !res.body) throw new Error(`director model ${res.status}`);
    // The Comfy Router answers chat as one JSON document even when asked to stream: replay it as the stream's chunks.
    const whole = (res.headers.get("content-type") ?? "").includes("application/json");
    yield* parseChatStream(whole ? asStream((await res.json()) as Completion) : lines(res.body));
  };
}

type Completion = {
  choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
  usage?: Record<string, unknown>;
};

/** A complete chat answer as the `data:` lines a stream would have sent: the text, each tool call, the usage. */
async function* asStream(c: Completion): AsyncGenerator<string> {
  const message = c.choices?.[0]?.message;
  const delta = {
    ...(message?.content ? { content: message.content } : {}),
    ...(message?.tool_calls?.length ? { tool_calls: message.tool_calls.map((t, index) => ({ index, function: t.function })) } : {}),
  };
  yield `data: ${JSON.stringify({ choices: [{ delta }] })}`;
  if (c.usage) yield `data: ${JSON.stringify({ choices: [], usage: c.usage })}`;
  yield "data: [DONE]";
}

/** Splits a byte stream into text lines, whatever the chunk boundaries. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        yield buf.slice(0, nl);
        buf = buf.slice(nl + 1);
      }
    }
    if (buf) yield buf;
  } finally {
    reader.releaseLock();
  }
}
