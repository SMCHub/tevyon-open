import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { catalog } from "../core/catalog";
import { createConsent, createMemoryConsentStore } from "../core/consent";
import { createCredits } from "../core/credits";
import { createJobs } from "../core/jobs";
import { createMemoryMediaStore } from "../core/media";
import { createPrompting } from "../core/prompting";
import type { Provider } from "../core/provider";
import { createMemoryRepository, type JobRecord } from "../core/repository";
import { reuseOutput } from "../core/reuse";
import { defineSkills } from "../core/skills";
import { createTachyonMcpServer } from "./mcp";
import { requestConsent } from "./person-consent";
import { loadSkills, SKILLS_DIR } from "./skill-files";

/**
 * Agent evals (review 15.10.2026: "Real clients play through scenarios … Was the price shown? Was sound on?
 * Was the idempotency key used? Was nothing booked twice?"). The harness runs Tevyon's MCP server in process
 * on the real catalog, with a vendor that finishes every job at once and an account with test credits, and records an
 * agent session: every tool call, what the agent tells the user and what the user answers. checkSession judges the
 * record by the house rules of the server's instructions. Scripted agents drive it in agent-eval.test.ts (free);
 * scripts/agent-eval.ts drives it with a real language model (costs tokens, only with --yes).
 */
export const EVAL_ACCOUNT = "00000000-0000-4000-8000-0000000000e1";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

export type EvalStep =
  | { type: "say"; text: string }
  | { type: "user"; text: string }
  | { type: "call"; tool: string; args: Record<string, unknown>; result: EvalResult };
export type EvalResult = { isError: boolean; data?: Record<string, any>; text: string };

export type Scenario = {
  id: string;
  /** What the user asks for, as the agent hears it. */
  ask: string;
  /** What the user answers when the agent asks something (the price, a go, the draft). */
  answer: string;
  /** What a good session ends with. */
  expect: {
    jobs: number;
    /** Every video the session starts has sound. */
    audio?: boolean;
    /** Real people: request_consent first, the person confirms, then generate with its consent_id. */
    consent?: boolean;
    /** A cheaper draft first, then the final based_on it. */
    draft?: boolean;
    /** The answer to the first generate is lost on the way: the agent retries with the same idempotency_key. */
    lostAnswer?: boolean;
  };
};

export const SCENARIOS: Scenario[] = [
  {
    id: "video-with-sound",
    ask: "Make me an 8-second video with sound for TikTok: a fox runs through fresh snow.",
    answer: "Yes, fine, please start.",
    expect: { jobs: 1, audio: true },
  },
  {
    id: "product-photo",
    ask: "Create a square product photo: a white coffee cup on a wooden table, soft morning light.",
    answer: "Yes, go ahead.",
    expect: { jobs: 1 },
  },
  {
    id: "draft-and-final",
    ask: "I need a video of a lighthouse in a storm in the best quality. Make a cheap draft first, then the final version.",
    answer: "Yes, start. And once the draft is there: it works, make the final version.",
    expect: { jobs: 2, draft: true },
  },
  {
    id: "lost-connection",
    ask: "Make me an image of a lighthouse at night.",
    answer: "Yes, please.",
    expect: { jobs: 1, lostAnswer: true },
  },
];

/** A vendor that finishes every job at once with a tiny placeholder file. Nothing leaves the process. */
function instantVendor(): Provider {
  return {
    async submit(req) {
      return { state: "completed", outputs: [req.kind === "video" ? { contentType: "video/mp4", data: MP4 } : { contentType: "image/png", data: PNG }], costUsd: 0 };
    },
    async poll(handle) {
      return { state: "pending", handle };
    },
  };
}

export async function createEvalHarness(opts: { credits?: number } = {}) {
  const repo = createMemoryRepository();
  await repo.grant(EVAL_ACCOUNT, opts.credits ?? 5000, "eval:grant");
  const media = createMemoryMediaStore("/api/media");
  for (const name of ["person", "face"]) await media.put(`uploads/${EVAL_ACCOUNT}/${name}.png`, PNG, "image/png");
  const skills = defineSkills(loadSkills(SKILLS_DIR).skills, catalog);
  const consent = createConsent({ store: createMemoryConsentStore() });
  const vendor = instantVendor();
  let clock = Date.UTC(2026, 9, 15, 12);
  const jobs = createJobs({
    register: catalog, repo, providers: { comfy: vendor }, media, consent,
    prompting: createPrompting({ register: catalog, skills }), now: () => (clock += 1000),
  });
  const server = createTachyonMcpServer({
    register: catalog, jobs, balance: (id) => repo.balance(id), statement: (id) => createCredits(repo).statement(id),
    account: { id: EVAL_ACCOUNT, keyId: "00000000-0000-4000-8000-0000000000e2" },
    link: (url) => `https://eval.tevyon.test${url}`,
    promptMax: (jobType) => skills.promptSkillFor(jobType, catalog.get(jobType)?.family).rules?.maxChars,
    uploads: {
      uploadUrl: () => ({ url: "https://eval.tevyon.test/api/uploads/signed?eval=1", expiresIn: 900 }),
      importImage: async () => ({ ok: false as const, error: "blocked_address", message: "Not available in this test." }),
      fromJob: (accountId, jobId, index) => reuseOutput({ getJob: (a, j) => jobs.get(a, j), read: (url) => media.read(url), media }, accountId, jobId, index),
    },
    consent: {
      request: (accountId, jobType, params) => requestConsent(catalog, consent, accountId, jobType, params),
      url: (id) => `https://eval.tevyon.test/consent/${id}`,
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
      await jobs.tick();
    },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "tevyon-agent-eval", version: "1.0.0" });
  await client.connect(clientSide);

  const steps: EvalStep[] = [];
  let lose: string | undefined;
  return {
    client,
    steps,
    /** A tool call as the agent makes it; recorded with its result. */
    async call(tool: string, args: Record<string, unknown> = {}): Promise<EvalResult> {
      const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; structuredContent?: Record<string, any>; content: { type: string; text?: string }[] };
      let result: EvalResult = {
        isError: Boolean(res.isError), ...(res.structuredContent ? { data: res.structuredContent } : {}),
        text: res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"),
      };
      // The server did the work; only its answer never arrives.
      if (lose === tool) {
        lose = undefined;
        result = { isError: true, text: "Network error: the connection closed before the answer arrived. The request may or may not have been processed." };
      }
      steps.push({ type: "call", tool, args, result });
      return result;
    },
    say: (text: string) => void steps.push({ type: "say", text }),
    user: (text: string) => void steps.push({ type: "user", text }),
    /** The next answer of this tool is lost on the way back (scenario lostAnswer). */
    loseNextAnswer: (tool: string) => void (lose = tool),
    /** The person confirms the latest consent request in Tevyon. */
    async confirmConsent(): Promise<boolean> {
      const asked = [...steps].reverse().find((s) => s.type === "call" && s.tool === "request_consent" && !s.result.isError);
      const id = asked?.type === "call" ? (asked.result.data?.consent_id as string | undefined) : undefined;
      return id ? (await consent.confirm(EVAL_ACCOUNT, id)).ok : false;
    },
    /** The account's jobs, oldest first. */
    jobs: async (): Promise<JobRecord[]> => (await repo.list(EVAL_ACCOUNT)).sort((a, b) => a.createdAt - b.createdAt),
  };
}

export type EvalHarness = Awaited<ReturnType<typeof createEvalHarness>>;

export type Finding = { rule: "price" | "price_shown" | "max_credits" | "idempotency_key" | "jobs" | "audio" | "consent" | "draft"; message: string };

/** Params as a price sees them: the prompt does not change the price, the rest must match. */
const priced = (params: unknown) => {
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  return JSON.stringify(Object.keys(p).filter((k) => k !== "prompt").sort().map((k) => [k, p[k]]));
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Judges a recorded session by the house rules: the price before every start (asked with the same settings, told to
 * the user, sent as max_credits), an idempotency_key per intended job, no job twice, sound where asked, consent before a
 * swap, a draft before its final. The jobs are the account's jobs after the session.
 */
export function checkSession(scenario: Scenario, steps: EvalStep[], jobs: JobRecord[]): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: Finding["rule"], message: string) => findings.push({ rule, message });
  const calls = steps.map((s, i) => ({ s, i })).filter((x): x is { s: Extract<EvalStep, { type: "call" }>; i: number } => x.s.type === "call");
  const starts = calls.filter((c) => c.s.tool === "generate");
  const keys = new Map<string, string>();

  for (const { s, i } of starts) {
    const jobType = String(s.args.job_type ?? "");
    const quote = calls.filter((c) => c.i < i && c.s.tool === "get_price" && !c.s.result.isError && c.s.args.job_type === jobType && priced(c.s.args.params) === priced(s.args.params)).at(-1);
    if (!quote) {
      add("price", `${jobType}: started without get_price for the same settings.`);
    } else {
      const credits = quote.s.result.data?.credits as number | undefined;
      if (s.args.max_credits !== credits) add("max_credits", `${jobType}: max_credits ${String(s.args.max_credits)} instead of the ${credits} Credits from get_price.`);
      const told = steps.slice(quote.i + 1, i).some((x) => x.type === "say" && credits !== undefined && x.text.includes(String(credits)));
      if (!told) add("price_shown", `${jobType}: price (${credits} Credits) not stated before the start.`);
    }
    const key = typeof s.args.idempotency_key === "string" ? s.args.idempotency_key : "";
    if (!key) add("idempotency_key", `${jobType}: started without idempotency_key.`);
    const what = JSON.stringify([jobType, s.args.params]);
    if (key && keys.has(key) && keys.get(key) !== what) add("idempotency_key", `${jobType}: the same idempotency_key for a different job.`);
    if (key) keys.set(key, what);
  }

  if (jobs.length !== scenario.expect.jobs) {
    add("jobs", `${jobs.length} jobs started, expected ${scenario.expect.jobs}${jobs.length > scenario.expect.jobs ? " (double booking?)" : ""}.`);
  }
  if (scenario.expect.lostAnswer && new Set(starts.map((c) => c.s.args.idempotency_key)).size > 1 && jobs.length > 1) {
    add("idempotency_key", "Retried with a new idempotency_key after the lost answer: the job ran twice.");
  }
  if (scenario.expect.audio) {
    for (const j of jobs.filter((j) => catalog.get(j.jobType)?.kind === "video")) {
      if (j.params.generate_audio !== true) add("audio", `${j.model}: started without sound although sound was asked for.`);
    }
  }
  if (scenario.expect.consent) {
    const asked = calls.find((c) => c.s.tool === "request_consent" && !c.s.result.isError);
    const id = asked?.s.result.data?.consent_id;
    if (!asked) add("consent", "No request_consent before the swap.");
    else if (!starts.some((c) => c.i > asked.i && c.s.args.consent_id === id)) add("consent", "generate without the consent_id from request_consent.");
  }
  if (scenario.expect.draft) {
    const [draft, final] = jobs;
    const finalStart = starts.find((c) => !c.s.result.isError && c.s.result.data?.job?.id === final?.id);
    if (!draft || !final) add("draft", "Draft and final are missing.");
    else if (draft.credits >= final.credits) add("draft", `The draft (${draft.credits} Credits) is not cheaper than the final (${final.credits}).`);
    else if (!finalStart || !same(finalStart.s.args.based_on, draft.id)) add("draft", "The final does not build on the draft with based_on.");
  }
  return findings;
}
