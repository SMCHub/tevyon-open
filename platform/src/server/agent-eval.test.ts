import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_ACCOUNT, SCENARIOS, checkSession, createEvalHarness, type EvalHarness, type Scenario } from "./agent-eval";
import { main } from "./agent-eval-cli";

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const key = () => crypto.randomUUID();

/** A careful agent: asks the price, tells the user, waits for the go, starts once with max_credits and its own key. */
async function startPriced(h: EvalHarness, jobType: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const price = await h.call("get_price", { job_type: jobType, params });
  h.say(`${price.data!.model}: ${price.data!.credits} Credits. Soll ich starten?`);
  h.user("Ja.");
  return h.call("generate", { job_type: jobType, params, idempotency_key: key(), max_credits: price.data!.credits, wait_seconds: 10, ...extra });
}

const careful: Record<string, (h: EvalHarness) => Promise<void>> = {
  "video-mit-ton": async (h) => {
    await h.call("list_models");
    await startPriced(h, "veo_3_1_lite", { prompt: "Ein Fuchs läuft durch frischen Schnee", duration: 8, aspect_ratio: "9:16", generate_audio: true });
  },
  produktfoto: async (h) => {
    await startPriced(h, "flux_3_image", { prompt: "Weisse Kaffeetasse auf einem Holztisch, weiches Morgenlicht", aspect_ratio: "1:1" });
  },
  "entwurf-und-final": async (h) => {
    const prompt = "Ein Leuchtturm im Sturm, Gischt schlägt hoch";
    const draft = await startPriced(h, "veo_3_1_lite", { prompt, duration: 4, resolution: "720p" });
    await startPriced(h, "veo_3_1_lite", { prompt, duration: 8, resolution: "1080p" }, { based_on: draft.data!.job.id });
  },
  "verbindung-weg": async (h) => {
    h.loseNextAnswer("generate");
    const params = { prompt: "Ein Leuchtturm bei Nacht", aspect_ratio: "16:9" };
    const price = await h.call("get_price", { job_type: "flux_3_image", params });
    h.say(`Das Bild kostet ${price.data!.credits} Credits. Starten?`);
    h.user("Ja.");
    const start = { job_type: "flux_3_image", params, idempotency_key: key(), max_credits: price.data!.credits, wait_seconds: 10 };
    expect((await h.call("generate", start)).isError).toBe(true);
    // Retried as the instructions say: the same key, so the job runs and is paid once.
    expect((await h.call("generate", start)).isError).toBe(false);
  },
};

async function run(s: Scenario, agent: (h: EvalHarness) => Promise<void>) {
  const h = await createEvalHarness();
  h.user(s.ask);
  await agent(h);
  return { h, findings: checkSession(s, h.steps, await h.jobs()) };
}

describe("agent evals (scripted agents, no model calls)", () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))("a careful agent passes «%s» on the real catalog", async (_id, s) => {
    const { findings, h } = await run(s, careful[s.id]!);
    expect(findings).toEqual([]);
    // Every job ran through to the end, with the reservation booked once.
    const jobs = await h.jobs();
    expect(jobs.map((j) => j.status)).toEqual(Array(s.expect.jobs).fill("succeeded"));
  });

  it("finds a start without a price, a price never told and a max_credits that is not the quote", async () => {
    const s = scenario("produktfoto");
    const params = { prompt: "Kaffeetasse", aspect_ratio: "1:1" };
    const unpriced = await run(s, async (h) => void (await h.call("generate", { job_type: "flux_3_image", params, idempotency_key: key() })));
    expect(unpriced.findings.map((f) => f.rule)).toEqual(["price"]);

    const untold = await run(s, async (h) => {
      const price = await h.call("get_price", { job_type: "flux_3_image", params });
      await h.call("generate", { job_type: "flux_3_image", params, idempotency_key: key(), max_credits: price.data!.credits });
    });
    expect(untold.findings.map((f) => f.rule)).toEqual(["price_shown"]);

    const loose = await run(s, async (h) => {
      const price = await h.call("get_price", { job_type: "flux_3_image", params });
      h.say(`${price.data!.credits} Credits.`);
      await h.call("generate", { job_type: "flux_3_image", params, idempotency_key: key(), max_credits: 999 });
    });
    expect(loose.findings.map((f) => f.rule)).toEqual(["max_credits"]);
  });

  it("finds a retry with a new key after a lost answer: the job ran and was paid twice", async () => {
    const { findings, h } = await run(scenario("verbindung-weg"), async (h) => {
      h.loseNextAnswer("generate");
      const params = { prompt: "Leuchtturm bei Nacht", aspect_ratio: "16:9" };
      const price = await h.call("get_price", { job_type: "flux_3_image", params });
      h.say(`${price.data!.credits} Credits.`);
      await h.call("generate", { job_type: "flux_3_image", params, idempotency_key: key(), max_credits: price.data!.credits });
      await h.call("generate", { job_type: "flux_3_image", params, idempotency_key: key(), max_credits: price.data!.credits });
    });
    expect(await h.jobs()).toHaveLength(2);
    expect(findings.map((f) => f.rule)).toEqual(["jobs", "idempotency_key"]);
  });

  it("finds a silent video where sound was asked for", async () => {
    const silent = await run(scenario("video-mit-ton"), async (h) => {
      await startPriced(h, "veo_3_1_lite", { prompt: "Fuchs im Schnee", duration: 8, aspect_ratio: "9:16", generate_audio: false });
    });
    expect(silent.findings.map((f) => f.rule)).toEqual(["audio"]);
  });
});

describe("agent evals with a language model (scripts/agent-eval.ts)", () => {
  it("only names the scenarios and the estimated cost without --yes", async () => {
    const lines: string[] = [];
    let called = 0;
    const code = await main(["--scenario", "produktfoto"], { root: os.tmpdir(), log: (l) => void lines.push(l), apiKey: "test", fetch: async () => (called++, new Response("{}")) });
    expect(code).toBe(0);
    expect(called).toBe(0);
    expect(lines[0]).toMatch(/^Agent-Evals mit Claude Sonnet 5\.5: 1 Szenarien \(produktfoto\), geschätzt \$\d+\.\d\d/);
  });

  it("runs a session: the model's tool calls reach the server, the user answers, the house rules judge it", async () => {
    // A scripted model in the vendor's answer format: price, ask, start with the quoted credits, report.
    type Msg = { role: string; content?: string; tool_calls?: unknown[] };
    const reply = (message: Record<string, unknown>) => new Response(JSON.stringify({ choices: [{ message }], usage: { cost: 0.01 } }));
    const call = (name: string, args: Record<string, unknown>) => ({ content: "", tool_calls: [{ id: `c-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    const params = { prompt: "Weisse Kaffeetasse auf Holz", aspect_ratio: "1:1" };
    const fake = async (_url: unknown, init?: RequestInit) => {
      const { messages } = JSON.parse(String(init!.body)) as { messages: Msg[] };
      const last = messages.at(-1)!;
      if (last.role === "user" && messages.filter((m) => m.role === "user").length === 1) return reply(call("get_price", { job_type: "flux_3_image", params }));
      if (last.role === "tool" && !messages.some((m) => m.tool_calls && JSON.stringify(m.tool_calls).includes("generate"))) {
        return reply({ content: `Das Produktfoto kostet ${JSON.parse(last.content!).credits} Credits. Soll ich starten?` });
      }
      if (last.role === "user") {
        const credits = JSON.parse(messages.find((m) => m.role === "tool")!.content!).credits;
        return reply(call("generate", { job_type: "flux_3_image", params, idempotency_key: "k-1", max_credits: credits, wait_seconds: 10 }));
      }
      return reply({ content: "Fertig, hier ist dein Bild." });
    };
    const root = mkdtempSync(path.join(os.tmpdir(), "agent-eval-"));
    const lines: string[] = [];

    const code = await main(["--scenario", "produktfoto", "--yes"], { root, log: (l) => void lines.push(l), apiKey: "test", fetch: fake as typeof fetch });

    expect(code).toBe(0);
    expect(lines).toContain("✓ produktfoto");
    expect(lines).toContain("1 von 1 Szenarien ohne Befund, Kosten $0.04.");
    const [file] = readdirSync(path.join(root, ".data/evals"));
    const saved = JSON.parse(readFileSync(path.join(root, ".data/evals", file!), "utf8"));
    expect(saved.report[0]).toMatchObject({ scenario: "produktfoto", findings: [] });
    // The key never lands in the report.
    expect(JSON.stringify(saved)).not.toContain("Bearer");
  });
});
