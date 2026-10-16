import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultTextModel, TEXT_MODELS, textModel, type TextModelDef } from "../core/text-models";
import { chatUrl, comfyKey } from "./comfy";
import { SCENARIOS, checkSession, createEvalHarness, type Finding, type Scenario } from "./agent-eval";

/**
 * Agent evals with a real language model (scripts/agent-eval.ts): the model plays the agent against Tevyon's MCP server
 * in process (agent-eval.ts: real catalog, a vendor that finishes at once, test credits), a scripted user answers,
 * and checkSession judges every session by the house rules. Generations cost nothing; the model's tokens do. Without
 * --yes it only shows the scenarios and the estimated cost. Report: .data/evals/<time>.json. Server-only.
 */
/** Model calls one session may take (each is one turn of the agent). */
const MAX_TURNS = 14;
/** What a session typically sends and gets back, for the estimate: the tool list and instructions are sent every turn. */
const TYPICAL = { turns: 8, baseTokens: 9000, growthPerTurn: 1200, outputPerTurn: 350 };
const SYSTEM = "You are an assistant in a chat with a user of Tevyon, an image and video platform. Use the Tevyon tools to do what the user asks. "
  + "Answer the user in English, briefly. When you need the user's answer, end your turn and ask.";

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type Completion = { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };

export function estimateUsd(model: TextModelDef, sessions: number): number {
  let input = 0;
  for (let t = 0; t < TYPICAL.turns; t++) input += TYPICAL.baseTokens + t * TYPICAL.growthPerTurn;
  const perSession = (input * model.price.inputPerM + TYPICAL.turns * TYPICAL.outputPerTurn * model.price.outputPerM) / 1e6;
  return Math.round(perSession * sessions * 100) / 100;
}

export async function main(argv: string[], opts: { root: string; fetch?: typeof fetch; log?: (line: string) => void; apiKey?: string }): Promise<number> {
  const log = opts.log ?? console.log;
  const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const model = value("--model") ? textModel(value("--model")!) : defaultTextModel();
  if (!model) {
    log(`Unknown model. Available: ${TEXT_MODELS.map((m) => m.id).join(", ")}`);
    return 1;
  }
  const wanted = value("--scenario")?.split(",").map((s) => s.trim()).filter(Boolean);
  const scenarios = wanted ? SCENARIOS.filter((s) => wanted.includes(s.id)) : SCENARIOS;
  if (!scenarios.length) {
    log(`No matching scenario. Available: ${SCENARIOS.map((s) => s.id).join(", ")}`);
    return 1;
  }
  const estimate = estimateUsd(model, scenarios.length);
  log(`Agent evals with ${model.name}: ${scenarios.length} scenario(s) (${scenarios.map((s) => s.id).join(", ")}), estimated $${estimate.toFixed(2)} for the tokens.`);
  if (!argv.includes("--yes")) {
    log("Without --yes nothing is called. With --yes the scenarios run against the model; the generations themselves cost nothing.");
    return 0;
  }
  const apiKey = opts.apiKey ?? comfyKey();
  if (!apiKey) {
    log("COMFY_API_KEY is missing (platform/.env.local).");
    return 1;
  }

  const doFetch = opts.fetch ?? fetch;
  const report: { scenario: string; findings: Finding[]; costUsd: number; steps: unknown[] }[] = [];
  let spent = 0;
  for (const s of scenarios) {
    const out = await session(s, model, apiKey, doFetch);
    spent += out.costUsd;
    report.push({ scenario: s.id, ...out });
    log(`${out.findings.length ? "✗" : "✓"} ${s.id}${out.findings.map((f) => `\n    ${f.rule}: ${f.message}`).join("")}`);
  }
  const failed = report.filter((r) => r.findings.length).length;
  log(`${scenarios.length - failed} of ${scenarios.length} scenarios without findings, cost $${spent.toFixed(2)}.`);
  const dir = path.join(opts.root, ".data/evals");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `agent-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ model: model.id, at: new Date().toISOString(), costUsd: spent, report }, null, 2));
  log(`Report: ${path.relative(opts.root, file)}`);
  return failed ? 2 : 0;
}

/** One scenario: the model plays the agent, the harness records, a scripted user answers. */
async function session(s: Scenario, model: TextModelDef, apiKey: string, doFetch: typeof fetch) {
  const h = await createEvalHarness();
  if (s.expect.lostAnswer) h.loseNextAnswer("generate");
  const { tools } = await h.client.listTools();
  const specs = tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema } }));
  const messages: Message[] = [{ role: "system", content: `${SYSTEM}\n\n${h.client.getInstructions() ?? ""}` }, { role: "user", content: s.ask }];
  h.user(s.ask);
  let costUsd = 0;
  let answers = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await doFetch(chatUrl(), {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-title": "Tevyon agent eval" },
      body: JSON.stringify({ model: model.route.slug, messages, tools: specs, tool_choice: "auto", max_tokens: 1500, usage: { include: true } }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => ({}))) as Completion;
    if (!res.ok || !body.choices?.[0]?.message) throw new Error(`model call failed: HTTP ${res.status} ${body.error?.message ?? ""}`.trim());
    costUsd += body.usage?.cost ?? 0;
    const msg = body.choices[0].message;
    const calls = msg.tool_calls ?? [];
    messages.push({ role: "assistant", content: msg.content ?? "", ...(calls.length ? { tool_calls: calls } : {}) });
    if (msg.content?.trim()) h.say(msg.content);
    if (calls.length) {
      for (const c of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || "{}");
        } catch {
          // Broken arguments go to the server as they are: its answer tells the agent what is wrong.
        }
        const result = await h.call(c.function.name, args);
        messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result.data ?? { error: result.isError, text: result.text }).slice(0, 6000) });
      }
      continue;
    }
    // The agent asks or reports: the person confirms a consent link, the user answers, or the session is over.
    if ((await h.jobs()).length >= s.expect.jobs || answers >= 3) break;
    let reply = s.answer;
    if (msg.content?.includes("/consent/") && (await h.confirmConsent())) reply = `I confirmed in Tevyon. ${s.answer}`;
    answers++;
    h.user(reply);
    messages.push({ role: "user", content: reply });
  }
  return { findings: checkSession(s, h.steps, await h.jobs()), costUsd, steps: h.steps };
}
