import { describe, expect, it } from "vitest";
import type { ModelEvent } from "../core/director-stream";
import { textModel } from "../core/text-models";
import { createDirectorModel } from "./director-llm";

/** A streamed response whose bytes arrive in odd pieces, as they do over the network. */
function sseResponse(text: string, status = 200) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

function recordingFetch(response: Response) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

const SSE = [
  ": OPENROUTER PROCESSING",
  `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}`,
  `data: ${JSON.stringify({ choices: [{ delta: { content: "Welt" } }] })}`,
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "propose_preset", arguments: '{"preset_id":"portal"}' } }] } }] })}`,
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0004 } })}`,
  "data: [DONE]",
  "",
].join("\n");

async function collect(stream: AsyncIterable<ModelEvent>) {
  const out: ModelEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe("Director language model over the provider", () => {
  it("streams the chosen model with tools, real cost and no training on user data", async () => {
    const { f, calls } = recordingFetch(sseResponse(SSE));
    const model = createDirectorModel({ apiKey: "k", model: textModel("claude-sonnet-5-5")!, fetch: f });

    const events = await collect(model([{ role: "user", content: "hi" }], [{ name: "propose_preset", description: "d", parameters: {} }]));

    expect(events).toEqual([
      { type: "text", delta: "Hello " },
      { type: "text", delta: "Welt" },
      { type: "tool_call", call: { name: "propose_preset", args: { preset_id: "portal" } } },
      { type: "usage", costUsd: 0.0004, inputTokens: 100, outputTokens: 20 },
    ]);
    const body = calls[0]!.body;
    expect(body).toMatchObject({
      model: "anthropic/claude-sonnet-5.5",
      stream: true,
      usage: { include: true },
      provider: { data_collection: "deny" },
      reasoning: { effort: "low" },
      tool_choice: "auto",
    });
    expect(body.tools).toEqual([{ type: "function", function: { name: "propose_preset", description: "d", parameters: {} } }]);
    expect(body).not.toHaveProperty("temperature");
  });

  it("lets the strongest models think a little longer", async () => {
    const { f, calls } = recordingFetch(sseResponse("data: [DONE]\n"));
    await collect(createDirectorModel({ apiKey: "k", model: textModel("claude-fable-5-1")!, fetch: f })([{ role: "user", content: "hi" }], []));
    expect(calls[0]!.body).toMatchObject({ model: "anthropic/claude-fable-5.1", reasoning: { effort: "medium" } });
  });

  it("fails loudly when the provider refuses, so the route can answer with its own message", async () => {
    const { f } = recordingFetch(new Response("payment required", { status: 402 }));
    await expect(collect(createDirectorModel({ apiKey: "k", model: textModel("claude-haiku-5-5")!, fetch: f })([{ role: "user", content: "hi" }], []))).rejects.toThrow(/402/);
  });
});
