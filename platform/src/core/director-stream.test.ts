import { describe, expect, it } from "vitest";
import { createStreamSanitizer, matchCount, parseChatStream, type ModelEvent } from "./director-stream";

async function* lines(text: string) {
  for (const line of text.split("\n")) yield line;
}

async function collect(stream: AsyncIterable<ModelEvent>) {
  const out: ModelEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }], ...extra })}`;

describe("chat stream from the language model", () => {
  it("turns text deltas, tool-call fragments and the usage chunk into events, ignoring keepalives and reasoning", async () => {
    const sse = [
      ": OPENROUTER PROCESSING",
      "",
      chunk({ reasoning: "Der Nutzer will etwas Virales …" }),
      chunk({ content: "Hier sind " }),
      chunk({ content: "drei Ideen." }),
      chunk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "propose_preset", arguments: '{"preset_' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'id":"portal","why":"Wow"}' } }] }),
      chunk({ tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "propose_custom", arguments: '{"job_type":"kling_3_std",' } }] }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: '"prompt":"A dog surfing","why":"Lustig"}' } }] }),
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3100, completion_tokens: 420, cost: 0.0104 } })}`,
      "data: [DONE]",
    ].join("\n");

    expect(await collect(parseChatStream(lines(sse)))).toEqual([
      { type: "text", delta: "Hier sind " },
      { type: "text", delta: "drei Ideen." },
      { type: "tool_call", call: { name: "propose_preset", args: { preset_id: "portal", why: "Wow" } } },
      { type: "tool_call", call: { name: "propose_custom", args: { job_type: "kling_3_std", prompt: "A dog surfing", why: "Lustig" } } },
      { type: "usage", costUsd: 0.0104, inputTokens: 3100, outputTokens: 420 },
    ]);
  });

  it("drops a tool call whose arguments are not valid JSON instead of failing the turn", async () => {
    const sse = [chunk({ tool_calls: [{ index: 0, function: { name: "propose_preset", arguments: '{"preset_id": "por' } }] }), "data: [DONE]"].join("\n");
    expect(await collect(parseChatStream(lines(sse)))).toEqual([]);
  });

  it("reports an error the provider sends inside the stream", async () => {
    const sse = [chunk({ content: "Hal" }), `data: ${JSON.stringify({ error: { message: "upstream overloaded", code: 502 } })}`].join("\n");
    await expect(collect(parseChatStream(lines(sse)))).rejects.toThrow(/upstream overloaded/);
  });
});

describe("stream sanitizer", () => {
  it("removes the purchase route even when it arrives split across deltas", () => {
    const s = createStreamSanitizer();
    const out = [s.push("Ich rufe Veo über Open"), s.push("Router auf, notfalls fa"), s.push("l.ai. Fertig!"), s.flush()].join("");
    expect(out.toLowerCase()).not.toMatch(/openrouter|fal\.ai/);
    expect(out).toContain("Fertig!");
  });

  it("removes vendor model ids but keeps model names", () => {
    const s = createStreamSanitizer();
    const out = [s.push("Ich bin Claude Opus 5.5 (anthropic/claude-"), s.push("opus-5.5) und plane deinen Clip."), s.flush()].join("");
    expect(out).toContain("Claude Opus 5.5");
    expect(out).not.toMatch(/anthropic\//);
    expect(out).toContain("plane deinen Clip.");
  });

  it("passes ordinary text through unchanged, apart from holding back a short tail", () => {
    const s = createStreamSanitizer();
    expect([s.push("Hallo, "), s.push("das wird ein Hit."), s.flush()].join("")).toBe("Hallo, das wird ein Hit.");
  });
});

describe("number of proposals in the reply", () => {
  // The text is written before the tool calls; a dropped or missing call leaves «drei Ideen» above two cards (14.10.2026).
  it("sets the number the text names to the cards actually shown", () => {
    expect(matchCount("Ich zeige dir drei Ideen im Hochformat.", 2)).toBe("Ich zeige dir zwei Ideen im Hochformat.");
    expect(matchCount("Hier sind 3 Vorschläge.", 2)).toBe("Hier sind 2 Vorschläge.");
    expect(matchCount("Drei schnelle Wege zum Hook.", 4)).toBe("Vier schnelle Wege zum Hook.");
    expect(matchCount("Ich plane vier Creatives für den Launch.", 3)).toBe("Ich plane drei Creatives für den Launch.");
  });

  it("speaks of one in the singular, without the plural adjective", () => {
    expect(matchCount("Ich zeige dir drei Ideen.", 1)).toBe("Ich zeige dir eine Idee.");
    expect(matchCount("Drei virale Clips:", 1)).toBe("Einen Clip:");
    expect(matchCount("zwei Vorschläge", 1)).toBe("einen Vorschlag");
  });

  it("leaves the text alone when the number fits, nothing was shown, or the words count something else", () => {
    expect(matchCount("Ich zeige dir drei Ideen.", 3)).toBe("Ich zeige dir drei Ideen.");
    expect(matchCount("Ich zeige dir drei Ideen.", 0)).toBe("Ich zeige dir drei Ideen.");
    expect(matchCount("Der Hook sitzt in den ersten zwei Sekunden.", 3)).toBe("Der Hook sitzt in den ersten zwei Sekunden.");
    expect(matchCount("Hundertdrei Ideen", 2)).toBe("Hundertdrei Ideen");
  });
});
