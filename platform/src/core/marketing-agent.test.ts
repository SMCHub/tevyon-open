import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { runDirectorTurn, type ChatModel } from "./director";
import type { ToolCall } from "./director-stream";
import { findStyle, MS_STYLES } from "./marketing";
import { marketingAgent, type MarketingAgentContext, type MarketingShape } from "./marketing-agent";

/** Scripted language model, like in director.test.ts: text in two pieces, then the tool calls. */
function fakeModel(content: string, toolCalls: ToolCall[]) {
  const seen: Parameters<ChatModel>[0][] = [];
  const model: ChatModel = async function* (messages, tools) {
    seen.push(messages);
    expect(tools.map((t) => t.name)).toEqual(["propose_creative"]);
    const half = Math.ceil(content.length / 2);
    for (const delta of [content.slice(0, half), content.slice(half)]) if (delta) yield { type: "text", delta };
    for (const call of toolCalls) yield { type: "tool_call", call };
    yield { type: "usage", costUsd: 0.001 };
  };
  return { model, seen };
}

const has = (jobType: string) => catalog.get(jobType) !== undefined;
/** A price that shows what it was asked for: 10 per run, plus the duration, plus 100 with an avatar. */
const quotes: { styleId: string; shape: MarketingShape }[] = [];
const quote = (styleId: string, shape: MarketingShape) => {
  quotes.push({ styleId, shape });
  return 10 + (shape.duration ?? 0) + (shape.avatar ? 100 : 0);
};
const ctx = (over: Partial<MarketingAgentContext> = {}): MarketingAgentContext => ({ hasProduct: true, hasAvatar: false, ...over });
const propose = (args: Record<string, unknown>): ToolCall => ({ name: "propose_creative", args });

async function plan(calls: ToolCall[], over: Partial<MarketingAgentContext> = {}) {
  const { model, seen } = fakeModel("Here is your campaign plan.", calls);
  const turn = await runDirectorTurn({
    history: [{ role: "user", content: "Launch of my organic lemonade on Instagram" }], hasPhoto: true, model, quote: () => null,
    agent: marketingAgent(ctx(over), has, quote),
  });
  return { turn, seen };
}

const ugc = MS_STYLES.find((s) => s.flow === "ugc")!;
const motion = MS_STYLES.find((s) => s.flow === "motion")!;
const ad = MS_STYLES.find((s) => s.flow === "ads")!;
const poster = MS_STYLES.find((s) => s.flow === "poster")!;
const people = MS_STYLES.find((s) => s.flow === "product_shots_people")!;

describe("Marketing Agent: campaign plan", () => {
  it("turns proposals into priced creatives of real styles and templates, with caption and reason", async () => {
    const { turn } = await plan([
      propose({ style_id: "tpl-citrus-splash", why: "Fresh and summery", caption: "Summer in a bottle 🍋 #lemonade" }),
      propose({ style_id: ad.id, wish: "Fresher than ever", aspect_ratio: "9:16", why: "A clear claim for Stories" }),
      propose({ style_id: motion.id, duration: 10, aspect_ratio: "9:16", why: "Motion stops the thumb" }),
    ]);
    expect(turn.reply).toBe("Here is your campaign plan.");
    expect(turn.proposals).toHaveLength(3);
    expect(turn.proposals[0]).toMatchObject({
      type: "marketing", styleId: "tpl-citrus-splash", title: findStyle("tpl-citrus-splash")!.title, category: "product", kind: "image",
      cover: "/marketing/tpl-citrus-splash.webp", caption: "Summer in a bottle 🍋 #lemonade", why: "Fresh and summery", needs: [], credits: 10,
    });
    expect(turn.proposals[1]).toMatchObject({ styleId: ad.id, wish: "Fresher than ever", aspect: "9:16", lettering: true });
    expect(turn.proposals[2]).toMatchObject({ styleId: motion.id, kind: "video", duration: 10, aspect: "9:16", credits: 20 });
  });

  it("falls back to the style's format and length when the model asks for one the flow does not offer", async () => {
    const { turn } = await plan([propose({ style_id: motion.id, aspect_ratio: "21:9", duration: 99, why: "x" })]);
    expect(turn.proposals[0]).toMatchObject({ aspect: motion.aspect, duration: 5 });
  });

  it("drops what cannot run: unknown styles, UGC without a spoken line, styles that need an avatar nobody gave", async () => {
    const { turn } = await plan([
      propose({ style_id: "does-not-exist", why: "x" }),
      propose({ style_id: ugc.id, why: "no line" }),
      propose({ style_id: ugc.id, wish: "I drink this every morning", why: "a line, but no avatar" }),
      { name: "start_job", args: {} },
    ]);
    expect(turn.proposals).toEqual([]);
  });

  it("keeps UGC with a line once an avatar is there, priced with the avatar", async () => {
    const { turn } = await plan([propose({ style_id: ugc.id, wish: "I drink this every morning", why: "Real and relatable" })], { hasAvatar: true });
    expect(turn.proposals[0]).toMatchObject({ styleId: ugc.id, wish: "I drink this every morning", spoken: true, credits: 118 });
  });

  it("marks a missing product photo instead of dropping the idea, and needs a text for posters without one", async () => {
    const { turn } = await plan([
      propose({ style_id: ad.id, wish: "New", why: "x" }),
      propose({ style_id: poster.id, why: "no text, no photo" }),
      propose({ style_id: poster.id, wish: "Summer party", why: "with text" }),
    ], { hasProduct: false });
    expect(turn.proposals.map((p) => p.type === "marketing" && [p.styleId, p.needs])).toEqual([[ad.id, ["product"]], [poster.id, []]]);
  });

  it("passes an avatar to people styles only when there is one", async () => {
    quotes.length = 0;
    await plan([propose({ style_id: people.id, why: "x" })], { hasAvatar: false });
    await plan([propose({ style_id: people.id, why: "x" })], { hasAvatar: true });
    expect(quotes.map((q) => q.shape.avatar)).toEqual([false, true]);
  });

  it("shows at most four creatives and no duplicates", async () => {
    const same = propose({ style_id: ad.id, wish: "New", why: "x" });
    const { turn } = await plan([same, same, ...["tpl-marble-morning", "tpl-dune-shadow", "tpl-peony-bed", "tpl-studio-white"].map((id) => propose({ style_id: id, why: "x" }))]);
    expect(turn.proposals).toHaveLength(4);
    expect(turn.proposals.filter((p) => p.type === "marketing" && p.styleId === ad.id)).toHaveLength(1);
  });

  it("cuts wish and caption to their limits and keeps purchase routes out of every text", async () => {
    const { turn } = await plan([propose({ style_id: ad.id, wish: "x".repeat(400), caption: "y".repeat(900), why: "Cheap through the Comfy Router" })]);
    const p = turn.proposals[0]!;
    if (p.type !== "marketing") throw new Error("not marketing");
    expect(p.wish!.length).toBeLessThanOrEqual(200);
    expect(p.caption!.length).toBeLessThanOrEqual(600);
    expect(JSON.stringify(p)).not.toMatch(/comfy/i);
  });

  it("briefs the model with every style and template it may choose, the inputs at hand, and never a style prompt", async () => {
    const { seen } = await plan([], { hasAvatar: true, product: { name: "Organic lemonade", description: "Ginger and lemon" } });
    const system = String(seen[0]![0]!.content);
    for (const s of MS_STYLES) expect(system).toContain(s.id);
    expect(system).toContain("tpl-citrus-splash");
    expect(system).toContain("Organic lemonade");
    expect(system).toMatch(/Avatar photo: yes/);
    for (const s of MS_STYLES) expect(system).not.toContain(s.prompt.slice(0, 50));
  });
});
