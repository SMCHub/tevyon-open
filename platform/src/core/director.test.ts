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
      content: "Hier sind meine Ideen für deinen Clip.",
      toolCalls: [
        { name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog jumps through a glowing portal", aspect_ratio: "9:16", why: "Überraschung in der ersten Sekunde" } },
        { name: "propose_custom", args: { job_type: "kling_3_turbo", prompt: "A dog surfing a huge wave at sunset", aspect_ratio: "9:16", why: "Absurd und lustig" } },
      ],
    });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "Mach was Virales mit meinem Hund" }], hasPhoto: true, model, quote });
    expect(turn.reply).toBe("Hier sind meine Ideen für deinen Clip.");
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
    const { model } = fakeModel({ content: "Ich zeige dir drei Ideen im Hochformat.", toolCalls: [good, { ...good, args: { ...good.args, job_type: "ltx_2_5_fast" } }, refused] });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "Casino" }], hasPhoto: true, model, quote });
    expect(turn.proposals).toHaveLength(2);
    expect(turn.reply).toBe("Ich zeige dir zwei Ideen im Hochformat.");
  });

  it("keeps the format when only the length does not fit the model, and asks the model to always choose a format", async () => {
    const { model, seen } = fakeModel({
      content: "Ich mache dir einen Clip im Hochformat.",
      toolCalls: [{ name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog surfing at sunset", aspect_ratio: "9:16", duration: 7, why: "Hook" } }],
    });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "Hund surft" }], hasPhoto: false, model, quote });
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
    const { model } = fakeModel({ content: "Ich rufe Veo über den Comfy Router auf, als veo/veo-3.1-lite-generate-001.", toolCalls: [] });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "wie?" }], hasPhoto: false, model, quote });
    expect(turn.reply.toLowerCase()).not.toMatch(/comfy|veo\//);
  });

  it("tells the model which models exist and whether a photo is attached, and offers no presets", async () => {
    const { model, seen } = fakeModel({ content: "ok", toolCalls: [] });
    await runDirectorTurn({ history: [{ role: "user", content: "Idee?" }], hasPhoto: true, model, quote });
    const system = String(seen[0]![0]!.content);
    for (const def of catalog.list()) expect(system).toContain(def.jobType);
    expect(system).toContain("Foto angehängt: ja");
    expect(system.toLowerCase()).not.toMatch(/preset|comfy/);
    for (const def of catalog.list()) expect(system).not.toContain(def.route.providerModel);
  });

  it("asks before it proposes when there is no wish yet and never counts its cards", async () => {
    const { model, seen } = fakeModel({ content: "ok", toolCalls: [] });
    await runDirectorTurn({ history: [{ role: "user", content: "Hallo" }], hasPhoto: false, model, quote });
    const system = String(seen[0]![0]!.content);
    // A greeting got three random paid proposals (14.10.2026): proposals only for a concrete wish.
    expect(system).toContain("Ohne konkreten Wunsch");
    // «zwei Ideen» above three cards: the text is written before the tools, so it never names a number.
    expect(system).toContain("Nenne nie die Zahl deiner Vorschläge");
    expect(system).toContain("Glücksspiel");
  });

  it("talks like a director on set: the plan in the first person first, no praise, replies to tap at the end", async () => {
    const { model, seen } = fakeModel({ content: "ok", toolCalls: [] });
    await runDirectorTurn({ history: [{ role: "user", content: "Hund viral" }], hasPhoto: false, model, quote });
    const system = String(seen[0]![0]!.content);
    // A turn opens with what it makes and how (14.10.2026): «Ich verwandle … in …, mit …».
    expect(system).toContain("Ich-Form");
    expect(system).toContain("Dein erster Satz sagt, was");
    expect(system).toContain("ohne Lob");
    expect(system).not.toContain("begeisternd");
    expect(system).toContain("suggest_replies");
    // Started proposals come back marked in the history, so the next turn builds on them.
    expect(system).toContain("gestartet");
    expect(seen[0]!.length).toBe(2);
  });

  it("streams the reply while it is written, then the priced proposals and what the turn cost", async () => {
    const { model } = fakeModel({
      content: "Ideen für deinen Hund, alle im Hochformat.",
      toolCalls: [{ name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog jumps through a portal", aspect_ratio: "9:16", why: "Er springt durch ein Portal" } }],
      costUsd: 0.0123,
    });
    const events: DirectorEvent[] = [];
    for await (const e of streamDirectorTurn({ history: [{ role: "user", content: "Hund viral" }], hasPhoto: true, model, quote })) events.push(e);

    const text = events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.delta : "")).join("");
    expect(text).toBe("Ideen für deinen Hund, alle im Hochformat.");
    expect(events.filter((e) => e.type === "text").length).toBeGreaterThanOrEqual(1);
    expect(events.slice(-3)).toEqual([
      { type: "proposals", proposals: [expect.objectContaining({ type: "custom", jobType: "veo_3_1_lite", credits: 85 })] },
      { type: "usage", costUsd: 0.0123 },
      { type: "done", reply: "Ideen für deinen Hund, alle im Hochformat." },
    ]);
  });

  it("shows the model the attached photo when it can see images", async () => {
    const { model, seen } = fakeModel({ content: "Ich sehe einen Hund am Strand.", toolCalls: [] });
    const photo = { dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
    await runDirectorTurn({ history: [{ role: "user", content: "Was geht mit dem Foto?" }], hasPhoto: true, photo, model, quote });

    const messages = seen[0]!;
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "Was geht mit dem Foto?" }, { type: "image_url", image_url: { url: photo.dataUrl } }],
    });
    expect(String(messages[0]!.content)).toContain("Du siehst das Foto");
  });

  it("offers two or three short replies to tap next, cleaned like the text, and never as a proposal", async () => {
    const { model } = fakeModel({
      content: "Ich mache aus deinem Hund einen 6-Sekunden-Clip im Hochformat.",
      toolCalls: [
        { name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog jumps through a portal", aspect_ratio: "9:16", why: "Er springt durch ein Portal" } },
        {
          name: "suggest_replies",
          args: {
            replies: [
              "  Mach es düsterer ",
              "Lieber 16:9 für YouTube",
              "Lieber 16:9 für YouTube",
              "Über den Comfy Router mit kling/kling-3.0-turbo rechnen",
              "",
              42,
              "Viel zu lang: eine Antwort, die niemand antippen will, weil sie einen ganzen Absatz lang erklärt, was als Nächstes passieren soll",
              "Noch eine Variante mit Ton",
              "Und eine vierte",
            ],
          },
        },
      ],
    });
    const events: DirectorEvent[] = [];
    for await (const e of streamDirectorTurn({ history: [{ role: "user", content: "Hund viral" }], hasPhoto: true, model, quote })) events.push(e);

    const proposals = events.find((e) => e.type === "proposals");
    expect(proposals).toEqual({ type: "proposals", proposals: [expect.objectContaining({ jobType: "veo_3_1_lite" })] });
    const suggestions = events.find((e) => e.type === "suggestions");
    // A reply that names a purchase route is dropped whole: scrubbed it would read «Über mit rechnen».
    expect(suggestions).toEqual({ type: "suggestions", suggestions: ["Mach es düsterer", "Lieber 16:9 für YouTube", "Noch eine Variante mit Ton"] });
    // Order on the wire: the cards first, then the replies under them, then cost and the final text.
    expect(events.map((e) => e.type).slice(-4)).toEqual(["proposals", "suggestions", "usage", "done"]);
  });

  it("speaks in its own voice when the model calls the tools without a word (some fast models do)", async () => {
    const card = { name: "propose_custom", args: { job_type: "flux_3_image", prompt: "A dog as a superhero", aspect_ratio: "1:1", why: "Portal" } };
    const withCards = await runDirectorTurn({ history: [{ role: "user", content: "Hund" }], hasPhoto: true, model: fakeModel({ content: "", toolCalls: [card] }).model, quote });
    const asking = await runDirectorTurn({
      history: [{ role: "user", content: "Hallo" }], hasPhoto: false, quote,
      model: fakeModel({ content: "", toolCalls: [{ name: "suggest_replies", args: { replies: ["Ein Clip für TikTok"] } }] }).model,
    });
    expect(withCards.reply).not.toMatch(/Hier sind/);
    expect(withCards.reply).toMatch(/^Ich /);
    expect(asking.reply).toMatch(/\?$/);
    expect(asking.suggestions).toEqual(["Ein Clip für TikTok"]);
  });

  it("sends no suggestions event when the model offers none", async () => {
    const { model } = fakeModel({ content: "Was soll entstehen?", toolCalls: [{ name: "suggest_replies", args: { replies: ["", "   "] } }] });
    const events: DirectorEvent[] = [];
    for await (const e of streamDirectorTurn({ history: [{ role: "user", content: "Hallo" }], hasPhoto: false, model, quote })) events.push(e);
    expect(events.some((e) => e.type === "suggestions")).toBe(false);
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "Hallo" }], hasPhoto: false, model: fakeModel({ content: "Was soll entstehen?", toolCalls: [] }).model, quote });
    expect(turn.suggestions).toEqual([]);
  });

  it("keeps purchase routes and vendor ids out of the proposals as well as the text", async () => {
    const { model } = fakeModel({
      content: "Zwei Ideen.",
      toolCalls: [
        { name: "propose_custom", args: { job_type: "kling_3_turbo", prompt: "A neon city at night", aspect_ratio: "16:9", why: "Läuft über den Comfy Router mit kling/kling-3.0-turbo am besten" } },
        { name: "propose_custom", args: { job_type: "flux_3_image", prompt: "A neon city via bfl/flux-3-image", aspect_ratio: "1:1", why: "Stadt" } },
      ],
    });
    const turn = await runDirectorTurn({ history: [{ role: "user", content: "Stadt" }], hasPhoto: true, model, quote });

    expect(turn.proposals).toHaveLength(2);
    expect(JSON.stringify(turn.proposals)).not.toMatch(/comfy|kling\/|bfl\//i);
  });
});
