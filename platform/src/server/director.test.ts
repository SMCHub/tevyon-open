import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatModel } from "../core/director";
import type { ModelEvent } from "../core/director-stream";
import { createDirectorBudget, createMemoryDirectorUsage } from "../core/director-usage";
import { createMemoryRepository } from "../core/repository";
import { textModel, type TextModelDef } from "../core/text-models";
import { collectTurn, createDirectorService, parseDirectorInput, type DirectorDeps } from "./director";

const ACC = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const LONG = "Ideas for your dog, all in portrait and with a strong hook in the first second.";

type Script = { events?: ModelEvent[]; failAtStart?: boolean; failAfterText?: boolean; hangAfterText?: boolean };

/**
 * Language models scripted per turn; records which text model was asked, what it was sent and its abort signal.
 * The account holds `credits` (bought, if `paying`), so the strongest models can be tried with real bookings.
 */
function setup(opts: {
  scripts?: Script[]; dailyUsd?: number; demo?: boolean; paying?: boolean; credits?: number; owed?: number; standingFails?: number; noMarketing?: boolean;
  freeTurns?: DirectorDeps["freeTurns"];
} = {}) {
  const scripts = [...(opts.scripts ?? [])];
  const asked: { model: string; messages: ChatMessage[]; signal?: AbortSignal }[] = [];
  const logs: string[] = [];
  const photos: string[] = [];
  const repo = createMemoryRepository();
  void repo.grant(ACC, opts.credits ?? 100, opts.paying ? "stripe:cs_test" : `welcome:${ACC}`);
  // Like the wiring: no free budget while the account owes credits.
  const budget = createDirectorBudget({ store: createMemoryDirectorUsage(), dailyUsd: () => (opts.owed ? 0 : opts.dailyUsd ?? 0.25) });
  const deps: DirectorDeps = {
    standing: async () => {
      if ((opts.standingFails ?? 0) > 0) {
        opts.standingFails!--;
        throw new Error("db down");
      }
      return { paying: Boolean(opts.paying), owed: opts.owed ?? 0 };
    },
    ledger: repo,
    balance: (accountId) => repo.balance(accountId),
    model: (def: TextModelDef): ChatModel | null => {
      if (opts.demo) return null;
      return async function* (messages, _tools, signal) {
        asked.push({ model: def.id, messages, signal });
        const s = scripts.shift() ?? { events: [{ type: "text", delta: LONG }, { type: "usage", costUsd: 0.001 }] };
        if (s.failAtStart) throw new Error("director model 402");
        if (s.failAfterText || s.hangAfterText) {
          yield { type: "text", delta: LONG };
          if (s.failAfterText) throw new Error("stream broke");
          await new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
        }
        for (const e of s.events ?? []) yield e;
      };
    },
    budget,
    quote: (jobType) => (jobType ? 45 : null),
    ...(opts.noMarketing ? {} : { marketing: { has: () => true, quote: (styleId: string) => (styleId ? 30 : null) } }),
    photo: async (url) => {
      photos.push(url);
      return "data:image/jpeg;base64,/9j/AAAA";
    },
    log: (m) => logs.push(m),
    ...(opts.freeTurns ? { freeTurns: opts.freeTurns } : {}),
  };
  return { director: createDirectorService(deps), asked, logs, photos, budget, repo };
}

async function events(res: Response) {
  const text = await res.text();
  return text.split("\n\n").filter(Boolean).map((block) => JSON.parse(block.replace(/^data: /, "")) as { type: string } & Record<string, unknown>);
}

const ask = (content = "dog viral", extra: Record<string, unknown> = {}) => ({ history: [{ role: "user", content }], ...extra });

describe("Director service", () => {
  it("streams the reply and the priced proposals of the chosen model, and keeps what the turn cost to itself", async () => {
    const { director, asked, budget } = setup({
      scripts: [{
        events: [
          { type: "text", delta: LONG },
          { type: "tool_call", call: { name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog jumps through a portal", aspect_ratio: "9:16", why: "He jumps through a portal" } } },
          { type: "usage", costUsd: 0.02, inputTokens: 3000, outputTokens: 400 },
        ],
      }],
    });

    const res = await director.respond(ACC, ask("dog viral", { model: "gemini-3-1-pro" }));

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const out = await events(res);
    expect(out.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe(LONG);
    expect(out.find((e) => e.type === "proposals")).toMatchObject({ proposals: [{ type: "custom", jobType: "veo_3_1_lite", credits: 45 }] });
    expect(out.find((e) => e.type === "done")).toEqual({ type: "done", reply: LONG });
    expect(out.at(-1)).toMatchObject({ type: "budget", allowed: true });
    expect(out.at(-1)!.share as number).toBeCloseTo(0.92, 9);
    expect(JSON.stringify(out)).not.toMatch(/usage|cost|0\.02/i);
    expect(asked[0]!.model).toBe("gemini-3-1-pro");
    expect((await budget.status(ACC, textModel("gemini-3-1-pro")!)).share).toBeCloseTo(0.92, 9);
  });

  it("passes the replies to tap next on, in the stream and for callers that collect the turn (MCP)", async () => {
    const script = (): Script => ({
      events: [
        { type: "text", delta: LONG },
        { type: "tool_call", call: { name: "propose_custom", args: { job_type: "veo_3_1_lite", prompt: "A dog jumps through a portal", aspect_ratio: "9:16", why: "Portal" } } },
        { type: "tool_call", call: { name: "suggest_replies", args: { replies: ["Make it darker", "16:9 for YouTube instead"] } } },
        { type: "usage", costUsd: 0.01 },
      ],
    });
    const { director } = setup({ scripts: [script(), script()] });

    const out = await events(await director.respond(ACC, ask()));
    expect(out.find((e) => e.type === "suggestions")).toEqual({ type: "suggestions", suggestions: ["Make it darker", "16:9 for YouTube instead"] });

    const parsed = parseDirectorInput(ACC, ask());
    if (!parsed.ok) throw new Error(parsed.error);
    const started = await director.start(ACC, parsed.input);
    if (!started.ok) throw new Error(started.error);
    const turn = await collectTurn(started.events);
    expect(turn.suggestions).toEqual(["Make it darker", "16:9 for YouTube instead"]);
    expect(turn.proposals).toHaveLength(1);
  });

  it("takes the default model when none is chosen and refuses models it does not know", async () => {
    const { director, asked } = setup();

    await events(await director.respond(ACC, ask()));
    const unknown = await director.respond(ACC, ask("hi", { model: "gpt-4" }));

    expect(asked.map((a) => a.model)).toEqual(["claude-sonnet-5-5"]);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ ok: false, error: "unknown_model" });
  });

  it("stops before the model when today's budget does not reach a turn of the chosen model, faster models still run", async () => {
    const { director, asked, budget } = setup({ dailyUsd: 0.05 });
    await budget.record(ACC, textModel("claude-sonnet-5-5")!, 0.04);

    const strong = await director.respond(ACC, ask("hi", { model: "gemini-3-1-pro" }));
    const fast = await director.respond(ACC, ask("hi", { model: "claude-haiku-5-5" }));

    expect(strong.status).toBe(429);
    expect(await strong.json()).toMatchObject({ ok: false, error: "director_budget", reply: expect.stringContaining("Gemini 3.1 Pro") });
    expect(fast.status).toBe(200);
    await events(fast);
    expect(asked.map((a) => a.model)).toEqual(["claude-haiku-5-5"]);
  });

  it("shows the model the caller's own photo, never someone else's", async () => {
    const { director, asked, photos } = setup();
    const own = `/api/media/uploads/${ACC}/abc-1.jpg`;

    await events(await director.respond(ACC, ask("What can we do with this?", { photo: own })));
    const foreign = await director.respond(ACC, ask("Und damit?", { photo: `/api/media/uploads/${OTHER}/abc-2.jpg` }));

    expect(photos).toEqual([own]);
    expect(asked[0]!.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "What can we do with this?" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/AAAA" } }],
    });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toMatchObject({ error: "foreign_input" });
  });

  it("answers with its own words when the provider fails, before or during the reply", async () => {
    const { director, logs, budget } = setup({ scripts: [{ failAtStart: true }, { failAfterText: true }] });
    const sonnet = textModel("claude-sonnet-5-5")!;

    const before = await director.respond(ACC, ask());
    expect(before.status).toBe(503);
    expect(await before.json()).toMatchObject({ ok: false, error: "director_unavailable", reply: expect.stringContaining("can't get through") });
    expect((await budget.status(ACC, sonnet)).share).toBe(1);

    const during = await events(await director.respond(ACC, ask()));
    expect(during.map((e) => e.type)).toEqual(["text", "error", "budget"]);
    expect(JSON.stringify(during)).not.toMatch(/402|stream broke/);
    expect((await budget.status(ACC, sonnet)).share).toBeLessThan(1);
    expect(logs.join("\n")).toMatch(/402[\s\S]*stream broke/);
  });

  it("stops the model when the user leaves and still counts the turn", async () => {
    const { director, asked, budget } = setup({ scripts: [{ hangAfterText: true }] });

    const res = await director.respond(ACC, ask());
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    expect(asked[0]!.signal?.aborted).toBe(true);
    expect((await budget.status(ACC, textModel("claude-sonnet-5-5")!)).share).toBeLessThan(1);
  });

  it("runs at most two turns per account at once", async () => {
    const { director } = setup({ scripts: [{ hangAfterText: true }, { hangAfterText: true }] });

    const first = await director.respond(ACC, ask());
    const second = await director.respond(ACC, ask());
    const third = await director.respond(ACC, ask());
    const otherAccount = await director.respond(OTHER, ask());

    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: "director_busy" });
    expect(otherAccount.status).toBe(200);
    await otherAccount.text();
    await first.body!.cancel();
    const again = await director.respond(ACC, ask());
    expect(again.status).toBe(200);
    await again.text();
    await second.body!.cancel();
  });

  it("explains that it is not available in the demo and rejects broken requests", async () => {
    const demo = setup({ demo: true }).director;
    const res = await demo.respond(ACC, ask());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "director_demo", reply: expect.stringContaining("demo mode") });

    const { director } = setup();
    for (const body of [null, {}, { history: [] }, { history: [{ role: "assistant", content: "hi" }] }]) {
      const r = await director.respond(ACC, body);
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ error: "invalid_params" });
    }
  });

  it("lets the strongest models answer on bought credits: holds the cap, then charges what the turn cost", async () => {
    const { director, repo, budget } = setup({ paying: true, credits: 100, scripts: [{ events: [{ type: "text", delta: LONG }, { type: "usage", costUsd: 0.0712 }] }] });

    const res = await director.respond(ACC, ask("Storyboard please", { model: "claude-fable-5-1" }));
    const out = await events(res);

    expect(out.at(-1)).toEqual({ type: "charged", credits: 16 });
    expect(out.some((e) => e.type === "budget")).toBe(false);
    expect(await repo.balance(ACC)).toBe(84);
    expect(await repo.debits(ACC)).toMatchObject([{ kind: "director", state: "settled", credits: 16, model: "Claude Fable 5.1" }]);
    expect((await budget.status(ACC, textModel("claude-sonnet-5-5")!)).share).toBe(1);
  });

  it("keeps the strongest models for accounts that bought credits and do not owe any", async () => {
    for (const [standing, error, words] of [[{ paying: false }, "director_paid_only", "first Credits purchase"], [{ paying: true, owed: 300 }, "credits_owed", "owes 300 Credits"]] as const) {
      const { director, asked } = setup(standing);
      const res = await director.respond(ACC, ask("hi", { model: "gpt-6-astra" }));
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({ error, reply: expect.stringContaining(words) });
      expect(asked).toEqual([]);
    }
  });

  it("starts no paid message the credits cannot cover at its cap", async () => {
    const { director, asked, repo } = setup({ paying: true, credits: 20 });

    const res = await director.respond(ACC, ask("hi", { model: "claude-fable-5-1" }));

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "insufficient_credits", reply: expect.stringContaining("up to 33 Credits") });
    expect(asked).toEqual([]);
    expect(await repo.balance(ACC)).toBe(20);
  });

  it("gives a paid message back in full when the provider fails, before or during the reply", async () => {
    const { director, repo } = setup({ paying: true, credits: 100, scripts: [{ failAtStart: true }, { failAfterText: true }] });

    expect((await director.respond(ACC, ask("hi", { model: "claude-fable-5-1" }))).status).toBe(503);
    expect(await repo.balance(ACC)).toBe(100);

    const during = await events(await director.respond(ACC, ask("hi", { model: "claude-fable-5-1" })));
    expect(during.map((e) => e.type)).toEqual(["text", "error"]);
    expect(await repo.balance(ACC)).toBe(100);
  });

  it("charges a typical message when the user leaves a paid turn, so stopping early is never free", async () => {
    const { director, repo } = setup({ paying: true, credits: 100, scripts: [{ hangAfterText: true }] });

    const res = await director.respond(ACC, ask("hi", { model: "claude-fable-5-1" }));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    expect(await repo.balance(ACC)).toBe(85);
  });

  it("tells the model picker what each model costs today and which ones need a purchase or more credits", async () => {
    const free = await setup().director.overview(ACC);
    expect(free.models.find((m) => m.id === "claude-fable-5-1")).toMatchObject({ paid: true, allowed: false, locked: "purchase", credits: { typical: 15, cap: 33 } });
    expect(free.models.find((m) => m.id === "claude-sonnet-5-5")).toMatchObject({ paid: false, allowed: true, turnsLeft: 17 });
    expect(free).toMatchObject({ share: 1, paying: false });

    const short = await setup({ paying: true, credits: 20 }).director.overview(ACC);
    expect(short.models.find((m) => m.id === "claude-fable-5-1")).toMatchObject({ allowed: false, locked: "credits" });
    expect(short.models.find((m) => m.id === "claude-opus-5-5")).toMatchObject({ allowed: true });
    expect(JSON.stringify(short)).not.toMatch(/anthropic\/|comfy|inputPerM/i);
  });

  it("keeps only as much history as bounds the longest turn, the newest messages first", () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i} `.padEnd(1_900, "x") }));
    const parsed = parseDirectorInput(ACC, { history: [...long(19), { role: "user", content: "now" }] });
    if (!parsed.ok) throw new Error(parsed.error);

    const total = parsed.input.history.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(12_000);
    expect(parsed.input.history.at(-1)).toEqual({ role: "user", content: "now" });
    expect(parsed.input.history.length).toBe(7);

    const mixed = parseDirectorInput(ACC, { history: [{ role: "user", content: "short" }, ...long(7), { role: "user", content: "now" }] });
    if (!mixed.ok) throw new Error(mixed.error);
    expect(mixed.input.history.map((m) => m.content.slice(0, 2))).toEqual(["1 ", "2 ", "3 ", "4 ", "5 ", "6 ", "no"]);
  });

  it("gives a paid message back in full when the server stops it on its own deadline", async () => {
    const { director, repo } = setup({ paying: true, credits: 100, scripts: [{ hangAfterText: true }] });
    const parsed = parseDirectorInput(ACC, ask("hi", { model: "claude-fable-5-1" }));
    if (!parsed.ok) throw new Error(parsed.error);

    const s = await director.start(ACC, parsed.input);
    if (!s.ok) throw new Error(s.error);
    await s.events.next();
    s.stop("failed");
    for await (const _ of s.events) void _;

    expect(await repo.balance(ACC)).toBe(100);
  });

  it("frees the account's turn slot when a check fails before the stream, so a hiccup never locks anyone out", async () => {
    const { director } = setup({ paying: true, credits: 100, standingFails: 3 });

    for (let i = 0; i < 3; i++) await expect(director.respond(ACC, ask("hi", { model: "claude-fable-5-1" }))).rejects.toThrow("db down");
    const ok = await director.respond(ACC, ask("hi", { model: "claude-fable-5-1" }));

    expect(ok.status).toBe(200);
    await ok.text();
  });

  it("says that credits are owed instead of pretending today's budget ran out", async () => {
    const { director } = setup({ owed: 120 });
    const res = await director.respond(ACC, ask("hi"));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "credits_owed", reply: expect.stringContaining("owes 120 Credits") });
    expect(await setup({ owed: 120 }).director.overview(ACC)).toMatchObject({ owed: 120 });
  });

  it("stops free turns from a network whose share for the day is used up, unless the account has bought credits", async () => {
    const counted: string[] = [];
    const freeTurns = async (network: string) => (counted.push(network), counted.length <= 1);
    const free = setup({ freeTurns });

    const first = await free.director.respond(ACC, ask(), undefined, undefined, "net-a");
    expect(first.status).toBe(200);
    await first.text();
    const refused = await free.director.respond(ACC, ask(), undefined, undefined, "net-a");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ ok: false, error: "director_network_limit", reply: expect.stringContaining("buy Credits") });
    // Without a network (an OAuth connection, local development) nothing is counted per network.
    expect((await free.director.respond(ACC, ask())).status).toBe(200);
    expect(counted).toEqual(["net-a", "net-a"]);

    // An account that bought credits is never counted, whatever network it comes from.
    const paying = setup({ paying: true, freeTurns });
    expect((await paying.director.respond(ACC, ask(), undefined, undefined, "net-a")).status).toBe(200);
    expect(counted).toHaveLength(2);
  });

  it("counts paid messages over an API key against the key's daily limit, and says so", async () => {
    const key = { id: "20000000-0000-4000-8000-0000000000k1", dailyLimit: 40 };
    const { director } = setup({ paying: true, credits: 200, scripts: [{ events: [{ type: "text", delta: LONG }, { type: "usage", costUsd: 0.0712 }] }] });

    await events(await director.respond(ACC, ask("hi", { model: "claude-fable-5-1" }), undefined, key));
    const second = await director.respond(ACC, ask("hi", { model: "claude-fable-5-1" }), undefined, key);

    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ error: "key_limit_reached", limit: 40, used: 16 });
    const view = await director.overview(ACC, key);
    expect(view.models.find((m) => m.id === "claude-fable-5-1")).toMatchObject({ allowed: false, locked: "key_limit" });
    expect(view.models.find((m) => m.id === "claude-opus-5-5")).toMatchObject({ allowed: true });
    expect((await director.overview(ACC, { ...key, dailyLimit: null })).models.find((m) => m.id === "claude-fable-5-1")).toMatchObject({ allowed: true });
  });

  it("refuses an agent other than the Director or the Marketing Agent", () => {
    expect(parseDirectorInput(ACC, ask("x", { agent: "sales" }))).toMatchObject({ ok: false, error: "invalid_params" });
    expect(parseDirectorInput(ACC, ask("x", { agent: "director" }))).toMatchObject({ ok: true });
  });

  describe("as Marketing Agent", () => {
    const UPLOAD = `/api/media/uploads/${ACC}/product.jpg`;

    it("plans with the agent's prompt and tool, sees the product photo and prices its creatives", async () => {
      const { director, asked, photos } = setup({
        scripts: [{
          events: [
            { type: "text", delta: LONG },
            { type: "tool_call", call: { name: "propose_creative", args: { style_id: "ad-claim", wish: "Fresh", why: "A clear claim" } } },
            { type: "tool_call", call: { name: "propose_preset", args: { preset_id: "say-it", why: "does not belong here" } } },
            { type: "usage", costUsd: 0.002 },
          ],
        }],
      });
      const res = await director.respond(ACC, ask("Launch on Instagram", { agent: "marketing", photo: UPLOAD, hasAvatar: false, product: { name: "Organic lemonade" } }));
      const list = await events(res);
      const proposals = list.find((e) => e.type === "proposals")!.proposals as Record<string, unknown>[];
      expect(proposals).toEqual([expect.objectContaining({ type: "marketing", styleId: "ad-claim", wish: "Fresh", credits: 30 })]);
      expect(String(asked[0]!.messages[0]!.content)).toContain("Marketing Agent");
      expect(String(asked[0]!.messages[0]!.content)).toContain("Organic lemonade");
      expect(photos).toEqual([UPLOAD]);
    });

    it("refuses the agent without the marketing wiring", async () => {
      const { director } = setup({ noMarketing: true });
      const res = await director.respond(ACC, ask("x", { agent: "marketing" }));
      expect(res.status).toBe(503);
    });

    it("keeps the brief within bounds", () => {
      const parsed = parseDirectorInput(ACC, ask("x", { agent: "marketing", hasAvatar: true, product: { name: "n".repeat(500), description: 7 } }));
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.input.agent).toEqual({ kind: "marketing", hasAvatar: true, product: { name: "n".repeat(120) } });
    });
  });
});
