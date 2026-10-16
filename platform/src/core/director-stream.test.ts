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
      chunk({ reasoning: "The user wants something viral …" }),
      chunk({ content: "Here are " }),
      chunk({ content: "three ideas." }),
      chunk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "propose_preset", arguments: '{"preset_' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'id":"portal","why":"Wow"}' } }] }),
      chunk({ tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "propose_custom", arguments: '{"job_type":"kling_3_std",' } }] }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: '"prompt":"A dog surfing","why":"Funny"}' } }] }),
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3100, completion_tokens: 420, cost: 0.0104 } })}`,
      "data: [DONE]",
    ].join("\n");

    expect(await collect(parseChatStream(lines(sse)))).toEqual([
      { type: "text", delta: "Here are " },
      { type: "text", delta: "three ideas." },
      { type: "tool_call", call: { name: "propose_preset", args: { preset_id: "portal", why: "Wow" } } },
      { type: "tool_call", call: { name: "propose_custom", args: { job_type: "kling_3_std", prompt: "A dog surfing", why: "Funny" } } },
      { type: "usage", costUsd: 0.0104, inputTokens: 3100, outputTokens: 420 },
    ]);
  });

  it("drops a tool call whose arguments are not valid JSON instead of failing the turn", async () => {
    const sse = [chunk({ tool_calls: [{ index: 0, function: { name: "propose_preset", arguments: '{"preset_id": "por' } }] }), "data: [DONE]"].join("\n");
    expect(await collect(parseChatStream(lines(sse)))).toEqual([]);
  });

  it("reports an error the provider sends inside the stream", async () => {
    const sse = [chunk({ content: "Hel" }), `data: ${JSON.stringify({ error: { message: "upstream overloaded", code: 502 } })}`].join("\n");
    await expect(collect(parseChatStream(lines(sse)))).rejects.toThrow(/upstream overloaded/);
  });
});

describe("stream sanitizer", () => {
  it("removes the purchase route even when it arrives split across deltas", () => {
    const s = createStreamSanitizer();
    const out = [s.push("I call Veo via Open"), s.push("Router, or else fa"), s.push("l.ai. Done!"), s.flush()].join("");
    expect(out.toLowerCase()).not.toMatch(/openrouter|fal\.ai/);
    expect(out).toContain("Done!");
  });

  it("removes vendor model ids but keeps model names", () => {
    const s = createStreamSanitizer();
    const out = [s.push("I am Claude Opus 5.5 (anthropic/claude-"), s.push("opus-5.5) and plan your clip."), s.flush()].join("");
    expect(out).toContain("Claude Opus 5.5");
    expect(out).not.toMatch(/anthropic\//);
    expect(out).toContain("and plan your clip.");
  });

  it("passes ordinary text through unchanged, apart from holding back a short tail", () => {
    const s = createStreamSanitizer();
    expect([s.push("Hello, "), s.push("this will be a hit."), s.flush()].join("")).toBe("Hello, this will be a hit.");
  });
});

describe("number of proposals in the reply", () => {
  // The text is written before the tool calls; a dropped or missing call leaves "three ideas" above two cards (14.10.2026).
  it("sets the number the text names to the cards actually shown", () => {
    expect(matchCount("Here are three ideas in portrait.", 2)).toBe("Here are two ideas in portrait.");
    expect(matchCount("Here are 3 proposals.", 2)).toBe("Here are 2 proposals.");
    expect(matchCount("Three quick ways to the hook.", 4)).toBe("Four quick ways to the hook.");
    expect(matchCount("One idea, then: one idea.", 2)).toBe("One idea, then: one idea.");
  });

  it("speaks of one in the singular (English)", () => {
    expect(matchCount("I have three ideas for you.", 1)).toBe("I have one idea for you.");
    expect(matchCount("Three viral clips:", 1)).toBe("One viral clip:");
  });

  it("does the same for a German reply, since the Director answers in the user's language", () => {
    expect(matchCount("Ich zeige dir drei Ideen im Hochformat.", 2)).toBe("Ich zeige dir zwei Ideen im Hochformat.");
    expect(matchCount("Hier sind 3 Vorschläge.", 2)).toBe("Hier sind 2 Vorschläge.");
    expect(matchCount("Drei schnelle Wege zum Hook.", 4)).toBe("Vier schnelle Wege zum Hook.");
    expect(matchCount("Ich plane vier Creatives für den Launch.", 3)).toBe("Ich plane drei Creatives für den Launch.");
  });

  it("speaks of one in the singular in German, without the plural adjective", () => {
    expect(matchCount("Ich zeige dir drei Ideen.", 1)).toBe("Ich zeige dir eine Idee.");
    expect(matchCount("Drei virale Clips:", 1)).toBe("Einen Clip:");
    expect(matchCount("zwei Vorschläge", 1)).toBe("einen Vorschlag");
  });

  it("leaves the text alone when the number fits, nothing was shown, or the words count something else", () => {
    expect(matchCount("Here are three ideas.", 3)).toBe("Here are three ideas.");
    expect(matchCount("The hook sits in the first two seconds.", 3)).toBe("The hook sits in the first two seconds.");
    expect(matchCount("Twenty-three ideas", 2)).toBe("Twenty-three ideas");
    expect(matchCount("Ich zeige dir drei Ideen.", 3)).toBe("Ich zeige dir drei Ideen.");
    expect(matchCount("Ich zeige dir drei Ideen.", 0)).toBe("Ich zeige dir drei Ideen.");
    expect(matchCount("Der Hook sitzt in den ersten zwei Sekunden.", 3)).toBe("Der Hook sitzt in den ersten zwei Sekunden.");
    expect(matchCount("Hundertdrei Ideen", 2)).toBe("Hundertdrei Ideen");
  });
});
