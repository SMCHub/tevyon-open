import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { runDirectorTurn, streamDirectorTurn, type ChatModel, type DirectorEvent } from "./director";
import type { ToolCall } from "./director-stream";

type Reply = { content: string; toolCalls: ToolCall[]; costUsd?: number };

/** Scripted language model: streams the queued replies (text in two pieces, then tool calls, then usage) and records what it was sent. */
function fakeModel(...replies: Reply[]) {
  const seen: Parameters<ChatModel>[0][] = [];
  const model: ChatModel = async function* (messages) {
    seen.push(messages);
    const r = replies.shift() ?? { content: "…", toolCalls: [] };
    const half = Math.ceil(r.content.length / 2);
    for (const delta of [r.content.slice(0, half), r.content.slice(half)]) if (delta) yield { type: "text", delta };
    for (const call of r.toolCalls) yield { type: "tool_call", call };
    yield { type: "usage", ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}) };
  };
  return { model, seen };
}

const quote = (jobType: string, params: Record<string, unknown>) => {
  const def = catalog.get(jobType);
  const p = def?.params.safeParse({ ...params, image: undefined });
  return p?.success ? def!.credits(p.data) : null;
};

describe("Tevyon Director", () => {
  it("turns the model's tool calls into proposals with a price, but never starts anything itself", async () => {
    const { model } = fakeModel({
      content: "Here are my ideas for your clip.",
      toolCalls: [
        { name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog jumps through a glowing portal", aspect_ratio: "9:16", why: "Surprise in the first second" } },
        { name: "propose_custom", args: { job_type: "kling_3_turbo", prompt: "A dog surfing a huge wave at sunset", aspect_ratio: "9:16", why: "Absurd and funny" } },
      ],
    });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "Make something viral with my dog" }], hasPhoto: true, model, quote });
    expect(turn.reply).toBe("Here are my ideas for your clip.");
    expect(turn.proposals).toHaveLength(2);
    // Veo 3.1 Lite at its defaults: 8 s × 10.55 Comfy credits per second at 720p with sound = 84.4 → 85.
    expect(turn.proposals[0]).toMatchObject({ type: "custom", jobType: "veo_3_1_lite", params: { aspect_ratio: "9:16" }, credits: 85 });
    expect(turn.proposals[1]).toMatchObject({ type: "custom", jobType: "kling_3_turbo", kind: "video", model: "Kling 3.0 Turbo" });
    expect(turn.proposals[1]!.credits).toBeGreaterThan(0);
  });

  it("drops proposals for models that do not exist or do not validate, and any other tool", async () => {
    const { model } = fakeModel({
      content: "Ideen:",
      toolCalls: [
        { name: "propose_preset", args: { preset_id: "portal", why: "x" } },
        { name: "propose_custom", args: { job_type: "sora_9", prompt: "x", why: "x" } },
        { name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "", why: "leer" } },
        { name: "start_job", args: {} },
      ],
    });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "hi" }], hasPhoto: false, model, quote });
    expect(turn.proposals).toEqual([]);
  });

  it("names as many ideas as it shows cards, even when a proposal is refused", async () => {
    const good = { name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A neon casino at night", aspect_ratio: "9:16", why: "x" } };
    const refused = { name: "propose_custom", args: { job_type: "nope", prompt: "x", why: "x" } };
    const { model } = fakeModel({ content: "I have three ideas for you in portrait.", toolCalls: [good, { ...good, args: { ...good.args, job_type: "ltx_2_5_fast" } }, refused] });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "Casino" }], hasPhoto: true, model, quote });
    expect(turn.proposals).toHaveLength(2);
    expect(turn.reply).toBe("I have two ideas for you in portrait.");
  });

  it("keeps the format when only the length does not fit the model, and asks the model to always choose a format", async () => {
    const { model, seen } = fakeModel({
      content: "I am making you a portrait clip.",
      toolCalls: [{ name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog surfing at sunset", aspect_ratio: "9:16", duration: 7, why: "Hook" } }],
    });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "dog surfing" }], hasPhoto: false, model, quote });
    expect(turn.proposals[0]).toMatchObject({ type: "custom", params: { aspect_ratio: "9:16" } });
    const tools = (await import("./director")).DIRECTOR_TOOLS;
    expect(tools.find((t) => t.name === "propose_custom")!.parameters.required).toContain("aspect_ratio");
    expect(seen).toHaveLength(1);
  });

  it("shows at most three proposals", async () => {
    const call = { name: "propose_custom", args: { job_type: "flux_3_image", prompt: "A red fox in snow", aspect_ratio: "1:1", why: "x" } };
    const { model } = fakeModel({ content: "Viele Ideen", toolCalls: [call, call, call, call, call] });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "viel" }], hasPhoto: true, model, quote });
    expect(turn.proposals).toHaveLength(3);
  });

  it("never names the purchase route in its answer", async () => {
    const { model } = fakeModel({ content: "I call Veo via the Comfy Router, as veo/veo-3.1-lite-generate-001.", toolCalls: [] });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "how?" }], hasPhoto: false, model, quote });
    expect(turn.reply.toLowerCase()).not.toMatch(/comfy|veo\//);
  });

  it("tells the model which models exist and whether a photo is attached, and offers no presets", async () => {
    const { model, seen } = fakeModel({ content: "ok", toolCalls: [] });
    await runDirectorTurn({ history: [{ role: "user", content: "Idea?" }], hasPhoto: true, model, quote });
    const system = String(seen[0]![0]!.content);
    for (const def of catalog.list()) expect(system).toContain(def.jobType);
    expect(system).toContain("Photo attached: yes");
    expect(system.toLowerCase()).not.toMatch(/preset|comfy/);
    for (const def of catalog.list()) expect(system).not.toContain(def.route.providerModel);
  });

  it("asks before it proposes when there is no wish yet and never counts its cards", async () => {
    const { model, seen } = fakeModel({ content: "ok", toolCalls: [] });
    await runDirectorTurn({ history: [{ role: "user", content: "Hello" }], hasPhoto: false, model, quote });
    const system = String(seen[0]![0]!.content);
    // A greeting got three random paid proposals (14.10.2026): proposals only for a concrete wish.
    expect(system).toContain("Without a concrete wish");
    // "two ideas" above three cards: the text is written before the tools, so it never names a number.
    expect(system).toContain("Never state how many proposals you make");
    expect(system).toContain("gambling");
  });

  it("talks like a director on set: the plan in the first person first, no praise, replies to tap at the end", async () => {
    const { model, seen } = fakeModel({ content: "ok", toolCalls: [] });
    await runDirectorTurn({ history: [{ role: "user", content: "dog viral" }], hasPhoto: false, model, quote });
    const system = String(seen[0]![0]!.content);
    // A turn opens with what it makes and how (14.10.2026): "I turn … into …, with …".
    expect(system).toContain("first person");
    expect(system).toContain("Your first sentence says what");
    expect(system).toContain("without praise");
    expect(system).not.toContain("enthusiastic");
    expect(system).toContain("suggest_replies");
    // Started proposals come back marked in the history, so the next turn builds on them.
    expect(system).toContain("\"started\"");
    expect(seen[0]!.length).toBe(2);
  });

  it("streams the reply while it is written, then the priced proposals and what the turn cost", async () => {
    const { model } = fakeModel({
      content: "Ideas for your dog, all in portrait.",
      toolCalls: [{ name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog jumps through a portal", aspect_ratio: "9:16", why: "He jumps through a portal" } }],
      costUsd: 0.0123,
    });
    const events: DirectorEvent[] = [];
    for await (const e of streamDirectorTurn({ history: [{ role: "user", content: "dog viral" }], hasPhoto: true, model, quote })) events.push(e);

    const text = events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.delta : "")).join("");
    expect(text).toBe("Ideas for your dog, all in portrait.");
    expect(events.filter((e) => e.type === "text").length).toBeGreaterThanOrEqual(1);
    expect(events.slice(-3)).toEqual([
      { type: "proposals", proposals: [expect.objectContaining({ type: "custom", jobType: "veo_3_1_lite", credits: 85 })] },
      { type: "usage", costUsd: 0.0123 },
      { type: "done", reply: "Ideas for your dog, all in portrait." },
    ]);
  });

  it("shows the model the attached photo when it can see images", async () => {
    const { model, seen } = fakeModel({ content: "I see a dog on the beach.", toolCalls: [] });
    const photo = { dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
    await runDirectorTurn({ history: [{ role: "user", content: "What can we do with this photo?" }], hasPhoto: true, photo, model, quote });

    const messages = seen[0]!;
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "What can we do with this photo?" }, { type: "image_url", image_url: { url: photo.dataUrl } }],
    });
    expect(String(messages[0]!.content)).toContain("You can see the photo");
  });

  it("offers two or three short replies to tap next, cleaned like the text, and never as a proposal", async () => {
    const { model } = fakeModel({
      content: "I am turning your dog into a 6-second portrait clip.",
      toolCalls: [
        { name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog jumps through a portal", aspect_ratio: "9:16", why: "He jumps through a portal" } },
        {
          name: "suggest_replies",
          args: {
            replies: [
              "  Make it darker ",
              "16:9 for YouTube instead",
              "16:9 for YouTube instead",
              "Run it via the Comfy Router with kling/kling-3.0-turbo",
              "",
              42,
              "Far too long: a reply nobody wants to tap because it spends a whole paragraph explaining what should happen next",
              "One more variation with sound",
              "And a fourth one",
            ],
          },
        },
      ],
    });
    const events: DirectorEvent[] = [];
    for await (const e of streamDirectorTurn({ history: [{ role: "user", content: "dog viral" }], hasPhoto: true, model, quote })) events.push(e);

    const proposals = events.find((e) => e.type === "proposals");
    expect(proposals).toEqual({ type: "proposals", proposals: [expect.objectContaining({ jobType: "veo_3_1_lite" })] });
    const suggestions = events.find((e) => e.type === "suggestions");
    // A reply that names a purchase route is dropped whole: scrubbed it would read "Run it via with".
    expect(suggestions).toEqual({ type: "suggestions", suggestions: ["Make it darker", "16:9 for YouTube instead", "One more variation with sound"] });
    // Order on the wire: the cards first, then the replies under them, then cost and the final text.
    expect(events.map((e) => e.type).slice(-4)).toEqual(["proposals", "suggestions", "usage", "done"]);
  });

  it("speaks in its own voice when the model calls the tools without a word (some fast models do)", async () => {
    const card = { name: "propose_custom", args: { job_type: "flux_3_image", prompt: "A dog as a superhero", aspect_ratio: "1:1", why: "Portal" } };
    const withCards = await runDirectorTurn({ history: [{ role: "user", content: "dog" }], hasPhoto: true, model: fakeModel({ content: "", toolCalls: [card] }).model, quote });
    const asking = await runDirectorTurn({
      history: [{ role: "user", content: "Hello" }], hasPhoto: false, quote,
      model: fakeModel({ content: "", toolCalls: [{ name: "suggest_replies", args: { replies: ["A clip for TikTok"] } }] }).model,
    });
    expect(withCards.reply).not.toMatch(/Here are/);
    expect(withCards.reply).toMatch(/^I /);
    expect(asking.reply).toMatch(/\?$/);
    expect(asking.suggestions).toEqual(["A clip for TikTok"]);
  });

  it("sends no suggestions event when the model offers none", async () => {
    const { model } = fakeModel({ content: "What should we make?", toolCalls: [{ name: "suggest_replies", args: { replies: ["", "   "] } }] });
    const events: DirectorEvent[] = [];
    for await (const e of streamDirectorTurn({ history: [{ role: "user", content: "Hello" }], hasPhoto: false, model, quote })) events.push(e);
    expect(events.some((e) => e.type === "suggestions")).toBe(false);
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "Hello" }], hasPhoto: false, model: fakeModel({ content: "What should we make?", toolCalls: [] }).model, quote });
    expect(turn.suggestions).toEqual([]);
  });

  it("keeps purchase routes and vendor ids out of the proposals as well as the text", async () => {
    const { model } = fakeModel({
      content: "Two ideas.",
      toolCalls: [
        { name: "propose_custom", args: { job_type: "kling_3_turbo", prompt: "A neon city at night", aspect_ratio: "16:9", why: "Works best via the Comfy Router with kling/kling-3.0-turbo" } },
        { name: "propose_custom", args: { job_type: "flux_3_image", prompt: "A neon city via bfl/flux-3-image", aspect_ratio: "1:1", why: "City" } },
      ],
    });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "City" }], hasPhoto: true, model, quote });

    expect(turn.proposals).toHaveLength(2);
    expect(JSON.stringify(turn.proposals)).not.toMatch(/comfy|kling\/|bfl\//i);
  });
});
