import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { catalog } from "../core/catalog";
import { MS_STYLES, publicStyle, publicTemplates } from "../core/marketing";
import { createConsent, createMemoryConsentStore } from "../core/consent";
import { createCredits } from "../core/credits";
import { createJobs } from "../core/jobs";
import { createMemoryMediaStore } from "../core/media";
import { reuseOutput } from "../core/reuse";
import { createPrompting } from "../core/prompting";
import { defineRegister, jobType } from "../core/register";
import { createCommunity, createMemoryCommunityStore } from "../core/community";
import { createMemoryRepository } from "../core/repository";
import { defineSkills } from "../core/skills";
import { createFakeProvider } from "../core/testing/fake-provider";
import { TOOL_CARDS } from "../app/(studio)/settings/api/tool-cards";
import type { ClientEvent, ModelChoice } from "./director";
import { compactTemplate, createTachyonMcpServer, directorForMcp, type McpDeps, type McpDirectorStart } from "./mcp";
import { requestConsent } from "./person-consent";
import { loadSkills, SKILLS_DIR } from "./skill-files";

const ACC_1 = "00000000-0000-4000-8000-000000000001";
const ACC_2 = "00000000-0000-4000-8000-000000000002";
const PNG = new Uint8Array([137, 80, 78, 71]);
const KEY_ID = "00000000-0000-4000-8000-0000000000aa";

// The purchase route of the test models. It must never appear in anything an agent receives.
const SECRET_ROUTE = "secretvendor";

const register = defineRegister([
  jobType({
    jobType: "test_image",
    kind: "image",
    model: "Test Image 1",
    tagline: "Test maker · stills",
    params: z.object({ prompt: z.string().min(1), aspect_ratio: z.enum(["1:1", "16:9"]).default("1:1") }),
    credits: () => 4,
    route: { provider: SECRET_ROUTE, providerModel: `${SECRET_ROUTE}/image-x` },
  }),
  jobType({
    jobType: "test_video",
    kind: "video",
    model: "Test Video 1",
    tagline: "Test maker · clips",
    params: z.object({ prompt: z.string().min(1), duration: z.number().int().min(2).max(10).default(5), image: z.string().optional() }),
    credits: (p) => 3 * p.duration,
    route: { provider: SECRET_ROUTE, providerModel: `${SECRET_ROUTE}/video-y` },
  }),
]);

const skillList = [
  { name: "prompt-test-image", version: "1.0.0", kind: "prompt" as const, models: ["test_image"], description: "How to prompt Test Image", body: "Subject first.", rules: { maxChars: 400, minWords: 2, negations: "ok" as const, slots: ["subject"] } },
  { name: "prompt-test-video", version: "1.2.0", kind: "prompt" as const, models: ["test_video"], description: "How to prompt Test Video", body: "Say what the camera does.", rules: { maxChars: 400, minWords: 2, negations: "rephrase" as const, slots: ["subject", "camera"] } },
];
const book = defineSkills(skillList, register);

const DIRECTOR_MODELS: ModelChoice[] = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", maker: "Anthropic", tier: "ausgewogen", tagline: "Plans carefully", vision: true, default: true, cost: 2, paid: false, allowed: true, turnsLeft: 14 },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", maker: "Anthropic", tier: "beste", tagline: "The strongest", vision: true, default: false, cost: 4, paid: true, credits: { typical: 16, cap: 35 }, allowed: false, locked: "purchase" },
];

async function* replay(events: ClientEvent[]): AsyncGenerator<ClientEvent> {
  for (const e of events) yield e;
}

/** A Director that answers with a scripted turn and records what it was asked. */
function fakeDirector(answer: (body: Record<string, any>) => McpDirectorStart = () => turn([])) {
  const calls: { accountId: string; body: Record<string, any>; key?: unknown }[] = [];
  const overviews: { accountId: string; key?: unknown }[] = [];
  const dep: NonNullable<McpDeps["director"]> = {
    async start(accountId, body, _signal, key) {
      calls.push({ accountId, body: body as Record<string, any>, key });
      return answer(body as Record<string, any>);
    },
    async overview(accountId, key) {
      overviews.push({ accountId, key });
      return { share: 0.8, paying: false, models: DIRECTOR_MODELS };
    },
  };
  return { calls, overviews, dep };
}

function turn(events: ClientEvent[], onStop?: (reason: string) => void): McpDirectorStart {
  return { ok: true, model: { name: "Claude Sonnet 5.5" }, events: replay(events), stop: (reason) => onStop?.(reason ?? "left") };
}

// A preset as the server builds it: the recipe prompt goes to the model, never to the agent.
const RECIPE_PROMPT = "SECRET RECIPE PROMPT: the camera pulls back into space";
const fakePresets: NonNullable<McpDeps["presets"]> = {
  list: () => [
    { id: "earth-zoom", title: "Earth zoom", tagline: "From you into space", category: "viral", needs: "photo", badge: "top", wishHint: null, line: null, credits: 12 },
  ],
  build(id, { image, wish }) {
    if (id === "gone") return { ok: false, error: "unknown_job_type" };
    if (id !== "earth-zoom") return { ok: false, error: "unknown_recipe" };
    return {
      ok: true, jobType: "test_video", params: { prompt: RECIPE_PROMPT + (wish ? ` Additional wish: ${wish}` : ""), duration: 4, image },
      recipe: { id, title: "Earth zoom", ...(wish ? { wish } : {}) },
    };
  },
};

async function setup({ credits = 50, account = ACC_1, dailyLimit = null, director = fakeDirector().dep }: { credits?: number; account?: string; dailyLimit?: number | null; director?: McpDeps["director"] | null } = {}) {
  const repo = createMemoryRepository();
  await repo.grant(ACC_1, credits, "grant_1");
  await repo.grant(ACC_2, 50, "grant_2");
  const fake = createFakeProvider();
  const media = createMemoryMediaStore("/api/media");
  const prompting = createPrompting({ register, skills: book });
  // Every job gets its own instant, after the grants, so "newest first" is never a tie.
  let jobClock = Date.now();
  const jobs = createJobs({ register, repo, providers: { [SECRET_ROUTE]: fake }, media, prompting, now: () => (jobClock += 1000) });
  const community = createCommunity({ store: createMemoryCommunityStore(), job: (accountId, jobId) => jobs.get(accountId, jobId) });

  // Fake clock: every pause in a wait loop runs one worker pass.
  let t = Date.UTC(2026, 9, 13, 12);
  const hooks: { jobId: string; accountId: string; url: string }[] = [];
  const deps: McpDeps = {
    register,
    jobs,
    balance: (id) => repo.balance(id),
    statement: (id) => createCredits(repo).statement(id),
    lifecycle: (jobType) => (jobType === "test_video" ? { status: "deprecated", retiresAt: "2026-11-30", successor: "test_image" } : { status: "active" }),
    uploads: {
      uploadUrl: (accountId) => ({ url: `https://app.tachyon.test/api/uploads/signed?acc=${accountId}&id=u1&exp=1&sig=s`, expiresIn: 900 }),
      importImage: async (accountId, url) =>
        url.startsWith("https://images.example.com/")
          ? { ok: true as const, path: `/api/media/uploads/${accountId}/imported.png`, contentType: "image/png", bytes: 1234 }
          : { ok: false as const, error: "blocked_address", message: "not a public address" },
      fromJob: (accountId, jobId, index) => reuseOutput({ getJob: (a, j) => jobs.get(a, j), read: (url) => media.read(url), media }, accountId, jobId, index),
    },
    account: { id: account, email: "user@example.com", keyId: KEY_ID, dailyLimit },
    link: (url) => `https://app.tachyon.test${url}?sig=signed`,
    promptMax: (jobType) => book.promptSkillFor(jobType).rules?.maxChars,
    consent: {
      request: (accountId, jobType, params) => requestConsent(register, createConsent({ store: createMemoryConsentStore() }), accountId, jobType, params),
      url: (id) => `https://app.tachyon.test/consent/${id}`,
    },
    webhooks: {
      check: (url) => (url.startsWith("https://hooks.example.com/") ? null : "not a public address"),
      register: async (jobId, accountId, url) => void hooks.push({ jobId, accountId, url }),
      secret: () => "whsec_test",
    },
    now: () => t,
    wait: async (ms) => {
      t += ms;
      await jobs.tick();
    },
    ...(director ? { director } : {}),
    community,
    presets: fakePresets,
    marketing: fakeMarketing,
  };

  const results: unknown[] = [];
  const client = await connect(createTachyonMcpServer(deps));
  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await client.callTool({ name, arguments: args });
    results.push(res);
    return res as { isError?: boolean; structuredContent?: Record<string, any>; content: Record<string, any>[] };
  }
  return { call, client, jobs, repo, fake, results, community, hooks };
}

/** The Marketing Agent as the route wires it, reduced to what the tools pass through (logic tested in marketing.test.ts). */
const marketingCalls: { tool: string; accountId: string; body: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
const MS_JOB = { id: "00000000-0000-4000-8000-0000000000f1", jobType: "test_image", model: "Test Image 1", status: "queued", credits: 9, outputs: [], params: { recipe: { id: "ms:ugc-x", title: "Marketing · UGC" } }, createdAt: 0 };
const fakeMarketing: NonNullable<McpDeps["marketing"]> = {
  overview: () => ({
    categories: [{ id: "ugc", label: "UGC" }],
    styles: [
      { id: "ugc-x", category: "ugc", available: true, credits: 30, prompt: undefined },
      { id: "soon", category: "ugc", available: false, credits: null },
    ],
    templates: [
      { id: "tpl-ugc-x", base: "ugc-x", category: "ugc", available: true, credits: 30 },
      { id: "tpl-ad", base: "ad-x", category: "ads", available: true, credits: 10 },
      { id: "tpl-soon", base: "soon", category: "ugc", available: false, credits: null },
    ],
  }),
  async start(accountId, body, opts) {
    marketingCalls.push({ tool: "start", accountId, body, opts });
    if (body.styleId !== "ugc-x") return { ok: false, error: "unknown_style" };
    return { ok: true, jobs: [MS_JOB as never], next: { styleId: "ugc-x", wish: String(body.wish), duration: 8, aspect: "9:16", credits: 21 } };
  },
  async continueUgc(accountId, body, opts) {
    marketingCalls.push({ tool: "continue", accountId, body, opts });
    return { ok: true, job: { ...MS_JOB, id: "00000000-0000-4000-8000-0000000000f2" } as never };
  },
};

async function connect(server: ReturnType<typeof createTachyonMcpServer>) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

const text = (res: { content: Record<string, any>[] }) => res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

describe("tachyon mcp server", () => {
  it("offers the tools an agent needs and marks the read-only ones", async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["ask_director", "ask_marketing_agent", "continue_marketing_ugc", "create_upload", "generate", "get_account", "get_credits", "get_job", "get_price", "import_image", "list_director_models", "list_jobs", "list_marketing_styles", "list_models", "list_presets", "request_consent", "reuse_result", "run_marketing_style", "run_preset", "set_visibility"],
    );
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(readOnly).toEqual(["get_account", "get_credits", "get_job", "get_price", "list_director_models", "list_jobs", "list_marketing_styles", "list_models", "list_presets"]);
    expect(client.getInstructions()).toMatch(/get_price/);
  });

  describe("community", () => {
    it("shares a finished result in the community and makes it private again", async () => {
      const { call, fake, community } = await setup();
      fake.next({ state: "completed", outputs: [{ contentType: "image/png", data: PNG }] });
      const gen = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "a red fox in snow" }, wait_seconds: 20 });
      const id = (gen.structuredContent?.job as Record<string, any>).id as string;

      const first = await call("set_visibility", { job_id: id, visibility: "public" });
      expect(first.isError).toBe(true);
      expect(text(first)).toMatch(/^profile_required: .*Studio/);

      await community.saveProfile(ACC_1, { handle: "fox_maker", name: "Fox Maker", acceptTerms: true });
      const shared = await call("set_visibility", { job_id: id, visibility: "public", show_prompt: false });
      expect(shared.structuredContent).toEqual({ job_id: id, visibility: "public", show_prompt: false });
      expect((await community.feed()).items).toEqual([expect.objectContaining({ id, prompt: null, creator: { handle: "fox_maker", name: "Fox Maker", avatar: null }, likes: 0 })]);

      const back = await call("set_visibility", { job_id: id, visibility: "private" });
      expect(back.structuredContent).toEqual({ job_id: id, visibility: "private" });
      expect((await community.feed()).items).toEqual([]);
    });

    it("never shares someone else's job", async () => {
      const { call, community } = await setup({ account: ACC_2 });
      await community.saveProfile(ACC_2, { handle: "other_one", name: "Other", acceptTerms: true });
      const foreign = await call("set_visibility", { job_id: "00000000-0000-4000-8000-0000000000f9", visibility: "public" });
      expect(text(foreign)).toMatch(/^not_found/);
    });
  });

  it("has a card in the “API & MCP” console for every tool, read-only ones marked as reading", async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    expect(TOOL_CARDS.map((c) => c.name).sort()).toEqual(tools.map((t) => t.name).sort());
    for (const t of tools) {
      const card = TOOL_CARDS.find((c) => c.name === t.name)!;
      expect(card.effect === "read", t.name).toBe(Boolean(t.annotations?.readOnlyHint));
    }
  });

  describe("list_models", () => {
    it("lists every model with its parameters, prompt limit and starting price, never its prompt skill", async () => {
      const { call } = await setup();
      const res = await call("list_models");
      const models = res.structuredContent?.models as Record<string, any>[];
      expect(models.map((m) => m.job_type)).toEqual(["test_image", "test_video"]);
      expect(models[1]).toMatchObject({
        job_type: "test_video", kind: "video", model: "Test Video 1", description: "Test maker · clips",
        price_from: 15,
      });
      // Skills stay on the server.
      expect(models[1]).not.toHaveProperty("prompt_skill");
      expect(models[1]?.parameters.properties.duration).toMatchObject({ type: "integer", minimum: 2, maximum: 10, default: 5 });
      // The prompt limit is the one its skill enforces (the server cuts longer prompts), not a looser schema number.
      expect(models[1]?.parameters.properties.prompt).toMatchObject({ type: "string", maxLength: 400 });
    });

    it("shows each model's lifecycle, so agents move off a model before it retires", async () => {
      const { call } = await setup();
      const models = (await call("list_models")).structuredContent?.models as Record<string, any>[];
      expect(models[0]).toMatchObject({ job_type: "test_image", status: "active" });
      expect(models[1]).toMatchObject({ job_type: "test_video", status: "deprecated", retires_at: "2026-11-30", successor: "test_image" });
    });

    it("filters by kind", async () => {
      const { call } = await setup();
      const res = await call("list_models", { kind: "image" });
      expect((res.structuredContent?.models as Record<string, any>[]).map((m) => m.job_type)).toEqual(["test_image"]);
    });
  });

  describe("get_price", () => {
    it("shows the credit price, the balance and the prompt notes before anything starts", async () => {
      const { call, repo } = await setup({ credits: 50 });
      const res = await call("get_price", { job_type: "test_video", params: { prompt: "a fox", duration: 8 } });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent).toMatchObject({ job_type: "test_video", credits: 24, balance: 50, enough: true });
      expect(res.structuredContent).not.toHaveProperty("prompt_skill");
      expect(res.structuredContent?.notes).toEqual(expect.arrayContaining([expect.objectContaining({ code: "camera_missing" })]));
      expect(await repo.balance(ACC_1)).toBe(50);
    });

    it("answers unknown models and invalid parameters as tool errors that say what to do", async () => {
      const { call } = await setup();
      const unknown = await call("get_price", { job_type: "nope", params: { prompt: "x" } });
      expect(unknown.isError).toBe(true);
      expect(text(unknown)).toMatch(/unknown_job_type.*list_models/s);

      const invalid = await call("get_price", { job_type: "test_video", params: { prompt: "a fox", duration: 99 } });
      expect(invalid.isError).toBe(true);
      expect(text(invalid)).toMatch(/invalid_params.*duration/s);
    });
  });

  describe("generate", () => {
    it("starts a job, reserves its credits and says how to fetch the result", async () => {
      const { call, repo } = await setup({ credits: 50 });
      const res = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "a red fox in snow" } });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent?.job).toMatchObject({ job_type: "test_image", model: "Test Image 1", status: "queued", credits: 4 });
      expect(res.structuredContent?.balance).toBe(46);
      expect(text(res)).toMatch(/get_job/);
      expect(await repo.balance(ACC_1)).toBe(46);
    });

    it("sends the agent's own prompt unchanged in exact mode", async () => {
      const { call, fake } = await setup();
      const prompt = "Close-up of a red fox in fresh snow, the camera slowly pushes in, soft morning light";
      await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_video", params: { prompt }, prompt_mode: "exact", wait_seconds: 2 });
      expect(fake.requests[0]?.params.prompt).toBe(prompt);
    });

    it("waits for a quick result and links every output", async () => {
      const { call, fake } = await setup();
      fake.next({ state: "completed", outputs: [{ contentType: "image/png", data: PNG }] });
      const res = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "a red fox in snow" }, wait_seconds: 20 });

      const job = res.structuredContent?.job as Record<string, any>;
      expect(job.status).toBe("succeeded");
      expect(job.outputs).toEqual([{ url: `https://app.tachyon.test/api/media/${job.id}/0?sig=signed`, content_type: "image/png" }]);
      expect(res.content).toContainEqual(expect.objectContaining({ type: "resource_link", uri: job.outputs[0].url, mimeType: "image/png" }));
    });

    it("refuses a job the account cannot pay for", async () => {
      const { call, repo } = await setup({ credits: 3 });
      const res = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "a red fox in snow" } });
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/insufficient_credits.*4 credits.*3/s);
      expect(await repo.balance(ACC_1)).toBe(3);
    });

    it("records that the job came over MCP and with which key, for the statement", async () => {
      const { call, repo } = await setup();
      const res = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "a red fox in snow" } });
      const record = await repo.get((res.structuredContent?.job as Record<string, any>).id);
      expect(record).toMatchObject({ origin: "mcp", apiKeyId: KEY_ID });
    });

    it("builds a final on a draft (based_on), which reuses the draft's written prompt", async () => {
      const { call } = await setup({ credits: 500 });
      const draft = await call("generate", { idempotency_key: "draft", job_type: "test_video", params: { prompt: "a fox runs, wide shot", duration: 2 } });
      const draftId = (draft.structuredContent?.job as Record<string, any>).id;
      const final = await call("generate", { idempotency_key: "final", job_type: "test_video", params: { prompt: "a fox runs, wide shot", duration: 10 }, based_on: draftId });
      expect(final.isError).toBeFalsy();
      expect(final.structuredContent?.job).toMatchObject({ status: "queued", credits: 30 });

      const bad = await call("generate", { idempotency_key: "bad", job_type: "test_video", params: { prompt: "x y" }, based_on: "not-a-job" }).catch((e: unknown) => ({
        isError: true, content: [{ type: "text", text: String(e) }],
      }));
      expect(bad.isError).toBe(true);
      expect(text(bad)).toMatch(/based_on/);
    });

    it("requires an idempotency key, so that a retried call never charges twice", async () => {
      const { call, repo } = await setup({ credits: 50 });
      const res = await call("generate", { job_type: "test_image", params: { prompt: "a red fox in snow" } }).catch((e: unknown) => ({
        isError: true, content: [{ type: "text", text: String(e) }],
      }));
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/idempotency_key/);
      expect(await repo.balance(ACC_1)).toBe(50);
    });

    it("keeps the price the agent showed: no start when the job now costs more than max_credits", async () => {
      const { call, repo } = await setup({ credits: 50 });
      const args = { job_type: "test_video", params: { prompt: "a fox, wide shot", duration: 8 } };
      const higher = await call("generate", { ...args, idempotency_key: "k1", max_credits: 20 });
      expect(higher.isError).toBe(true);
      expect(text(higher)).toMatch(/price_changed.*24 credits/s);
      expect(await repo.balance(ACC_1)).toBe(50);

      const same = await call("generate", { ...args, idempotency_key: "k2", max_credits: 24 });
      expect(same.isError).toBeFalsy();
      expect(await repo.balance(ACC_1)).toBe(26);
    });

    it("stops at the key's daily limit and says how much is left", async () => {
      const { call, repo } = await setup({ credits: 50, dailyLimit: 6 });
      expect((await call("generate", { idempotency_key: "a", job_type: "test_image", params: { prompt: "a red fox in snow" } })).isError).toBeFalsy();
      const over = await call("generate", { idempotency_key: "b", job_type: "test_image", params: { prompt: "a red fox in snow" } });
      expect(over.isError).toBe(true);
      expect(text(over)).toMatch(/key_limit_reached.*6 credits per 24 hours and 4 are used/s);
      expect(await repo.balance(ACC_1)).toBe(46);
    });

    it("accepts a start image only from the account's own uploads", async () => {
      const { call, repo } = await setup({ credits: 50 });
      for (const image of [`/api/media/uploads/${ACC_2}/x.jpg`, `/api/media/uploads/${ACC_1}/../${ACC_2}/x.jpg`, "https://elsewhere.example/x.jpg"]) {
        const res = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_video", params: { prompt: "a fox runs, wide shot", image } });
        expect(res.isError).toBe(true);
        expect(text(res)).toMatch(/invalid_params.*image/s);
      }
      expect(await repo.balance(ACC_1)).toBe(50);
    });

    it("makes retries safe with an idempotency key", async () => {
      const { call, repo } = await setup({ credits: 50 });
      const args = { job_type: "test_image", params: { prompt: "a red fox in snow" }, idempotency_key: "agent-run-1" };
      const a = await call("generate", args);
      const b = await call("generate", args);
      expect((b.structuredContent?.job as Record<string, any>).id).toBe((a.structuredContent?.job as Record<string, any>).id);
      expect(await repo.balance(ACC_1)).toBe(46);
    });
  });

  it("posts a finished job to the agent's webhook instead of being polled, and checks the address before anything starts", async () => {
    const { call, hooks, repo } = await setup({ credits: 50 });
    const bad = await call("generate", { idempotency_key: "w1", job_type: "test_image", params: { prompt: "a fox" }, webhook_url: "https://169.254.169.254/x" });
    expect(text(bad)).toMatch(/^invalid_params: webhook_url/);
    expect(await repo.balance(ACC_1)).toBe(50);

    const res = await call("generate", { idempotency_key: "w2", job_type: "test_image", params: { prompt: "a fox" }, webhook_url: "https://hooks.example.com/tevyon" });
    const id = (res.structuredContent?.job as Record<string, any>).id;
    expect(hooks).toEqual([{ jobId: id, accountId: ACC_1, url: "https://hooks.example.com/tevyon" }]);
    expect(text(res)).toMatch(/webhook/);
  });

  it("reports progress while it waits, when the client asks for it", async () => {
    const { call, client } = await setup();
    const started = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_video", params: { prompt: "a fox runs, tracking shot" } });
    const id = (started.structuredContent?.job as Record<string, any>).id;
    const updates: { progress: number; total?: number; message?: string }[] = [];
    // The SDK client sends a progressToken with onprogress; the video keeps running for the whole wait.
    await client.callTool({ name: "get_job", arguments: { job_id: id, wait_seconds: 6 } }, { onprogress: (p: { progress: number; total?: number; message?: string }) => void updates.push(p) });
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((u, i) => i === 0 || u.progress > updates[i - 1]!.progress)).toBe(true);
    expect(updates.at(-1)).toMatchObject({ total: 6, message: expect.stringMatching(/Test Video 1.*running/) });
  });

  describe("get_job", () => {
    it("follows a long video across calls until it is done", async () => {
      const { call, fake } = await setup();
      const started = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_video", params: { prompt: "a fox runs, tracking shot" } });
      const id = (started.structuredContent?.job as Record<string, any>).id;

      const still = await call("get_job", { job_id: id, wait_seconds: 5 });
      expect(still.structuredContent?.job).toMatchObject({ id, status: "running" });
      expect(text(still)).toMatch(/get_job/);

      fake.next({ state: "completed", outputs: [{ contentType: "video/mp4", data: PNG }] });
      const done = await call("get_job", { job_id: id, wait_seconds: 5 });
      expect(done.structuredContent?.job).toMatchObject({ id, status: "succeeded" });
      expect(done.structuredContent?.job).not.toHaveProperty("prompt_skill");
    });

    it("explains a failed job and that its credits came back", async () => {
      const { call, fake, repo } = await setup({ credits: 50 });
      fake.next({ state: "failed", reason: "moderated", detail: `${SECRET_ROUTE} says: flagged by policy 7` });
      const res = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "a red fox in snow" }, wait_seconds: 5 });
      const job = res.structuredContent?.job as Record<string, any>;
      expect(job.status).toBe("failed");
      expect(job.error).toMatchObject({ code: "content_moderated" });
      expect(job.error.message).toMatch(/refunded/);
      expect(await repo.balance(ACC_1)).toBe(50);
    });

    it("does not reveal another account's job", async () => {
      const { call, jobs } = await setup();
      const foreign = await jobs.start(ACC_2, "test_image", { prompt: "someone else's fox" });
      if (!foreign.ok) throw new Error(foreign.error);
      const res = await call("get_job", { job_id: foreign.job.id });
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/not_found/);
    });
  });

  it("lists the account's own jobs, newest first, filtered and limited", async () => {
    const { call, jobs } = await setup();
    await jobs.start(ACC_2, "test_image", { prompt: "foreign" });
    await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "first fox" } });
    await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_video", params: { prompt: "second fox, wide shot" } });
    await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "third fox" } });

    const all = await call("list_jobs");
    expect((all.structuredContent?.jobs as Record<string, any>[]).map((j) => j.params.prompt)).toEqual(["third fox", "second fox, wide shot", "first fox"]);

    const images = await call("list_jobs", { kind: "image", limit: 1 });
    expect((images.structuredContent?.jobs as Record<string, any>[]).map((j) => j.params.prompt)).toEqual(["third fox"]);
  });

  it("shows the credit statement: what is available, held and spent, with every movement", async () => {
    const { call, fake } = await setup({ credits: 50 });
    fake.next({ state: "completed", outputs: [{ contentType: "image/png", data: PNG }] });
    await call("generate", { idempotency_key: "a", job_type: "test_image", params: { prompt: "a red fox in snow" }, wait_seconds: 5 });
    await call("generate", { idempotency_key: "b", job_type: "test_video", params: { prompt: "a fox runs, wide shot" } });

    const res = await call("get_credits", { limit: 2 });
    expect(res.structuredContent?.summary).toMatchObject({ available: 31, reserved: 15, spent: 4, granted: 50 });
    const entries = res.structuredContent?.entries as Record<string, any>[];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: "job", model: "Test Video 1", state: "reserved", amount: 15, origin: "mcp" });
    expect(entries[1]).toMatchObject({ kind: "job", model: "Test Image 1", state: "charged", amount: 4 });
    expect(text(res)).toMatch(/31 credits available/);
  });

  it("reports the account and its credits", async () => {
    const { call } = await setup({ credits: 42 });
    const res = await call("get_account");
    expect(res.structuredContent).toEqual({ email: "user@example.com", credits: 42, webhook_secret: "whsec_test" });
  });

  describe("start images", () => {
    it("hands an agent with a shell a signed upload address and the curl line to use it", async () => {
      const { call } = await setup();
      const res = await call("create_upload");
      expect(res.structuredContent).toMatchObject({ upload_url: expect.stringContaining(`acc=${ACC_1}`), method: "PUT", expires_in_seconds: 900 });
      expect(String(res.structuredContent?.curl)).toMatch(/^curl -X PUT --data-binary @/);
      expect(text(res)).toMatch(/params\.image/);
    });

    it("imports a public image into the account's uploads and refuses blocked addresses", async () => {
      const { call } = await setup();
      const ok = await call("import_image", { url: "https://images.example.com/fox.png" });
      expect(ok.structuredContent).toEqual({ image: `/api/media/uploads/${ACC_1}/imported.png`, content_type: "image/png", bytes: 1234 });
      const bad = await call("import_image", { url: "https://169.254.169.254/latest/meta-data" });
      expect(bad.isError).toBe(true);
      expect(text(bad)).toMatch(/blocked_address/);
    });
  });

  it("turns a finished result into an upload to use as a reference: the same path twice, nothing of other accounts", async () => {
    const { call, fake } = await setup();
    const make = async (data: Uint8Array) => {
      fake.next({ state: "completed", outputs: [{ contentType: "image/png", data }] });
      const gen = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "a red fox in snow" }, wait_seconds: 20 });
      return (gen.structuredContent?.job as Record<string, any>).id as string;
    };
    // Checked by its bytes like any upload: four bytes are no picture, the full PNG signature is.
    expect(text(await call("reuse_result", { job_id: await make(PNG) }))).toMatch(/^not_an_image/);
    const id = await make(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
    const first = await call("reuse_result", { job_id: id });
    expect(first.structuredContent).toEqual({ upload: expect.stringMatching(new RegExp(`^/api/media/uploads/${ACC_1}/[0-9a-f]{64}`)) });
    expect(text(first)).toMatch(/params\.references/);
    expect((await call("reuse_result", { job_id: id })).structuredContent).toEqual(first.structuredContent);
    expect(text(await call("reuse_result", { job_id: id, index: 3 }))).toMatch(/^not_found/);
    expect(text(await call("reuse_result", { job_id: "00000000-0000-4000-8000-0000000000f9" }))).toMatch(/^not_found/);
  });

  it("sends a marketing template as its differences from its style, from which every field of it follows", () => {
    // The real styles and templates (core/marketing.ts): the full list repeated every field of the style for about a
    // hundred templates, some 17,000 tokens per call.
    const all = () => true;
    const styles = new Map(MS_STYLES.map((st) => [st.id, publicStyle(st, all) as Record<string, unknown>]));
    const templates = publicTemplates(all) as Record<string, unknown>[];
    expect(templates.length).toBeGreaterThan(50);
    let full = 0;
    let compact = 0;
    for (const t of templates) {
      const style = styles.get(String(t.base));
      // As the agent receives it: through JSON, where undefined fields vanish.
      const sent = JSON.parse(JSON.stringify(compactTemplate(t, style))) as Record<string, unknown>;
      expect(sent, String(t.id)).toMatchObject({ id: t.id, base: t.base });
      const rebuilt: Record<string, unknown> = { ...JSON.parse(JSON.stringify(style)), ...sent };
      for (const key of Object.keys(t)) expect(rebuilt[key] ?? null, `${String(t.id)}.${key}`).toEqual(t[key] ?? null);
      full += JSON.stringify(t).length;
      compact += JSON.stringify(sent).length;
    }
    expect(compact).toBeLessThan(full / 2);
  });

  describe("marketing agent", () => {
    it("lists only available styles and starts one with the key's limits and the price guarantee", async () => {
      const { call } = await setup();
      const list = await call("list_marketing_styles", { category: "ugc" });
      expect((list.structuredContent?.styles as unknown[]).length).toBe(1);
      // Templates (concrete scenes of a style): available ones of the category, runnable by their id, each with only
      // what differs from its style (here nothing).
      expect(list.structuredContent?.templates).toEqual([{ id: "tpl-ugc-x", base: "ugc-x" }]);
      const res = await call("run_marketing_style", { style_id: "ugc-x", product: "/api/media/uploads/p.png", wish: "Hello", max_credits: 30, idempotency_key: "k-ms" });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent?.next).toMatchObject({ tool: "continue_marketing_ugc", frame_job_id: MS_JOB.id, max_credits: 21 });
      const started = marketingCalls.find((c) => c.tool === "start")!;
      expect(started.opts).toMatchObject({ origin: "mcp", apiKeyId: KEY_ID, maxCredits: 30, idempotencyKey: "k-ms" });
      const cont = await call("continue_marketing_ugc", { frame_job_id: MS_JOB.id, style_id: "ugc-x", wish: "Hello", max_credits: 21 });
      expect(cont.isError).toBeFalsy();
      expect(marketingCalls.find((c) => c.tool === "continue")!.opts).toMatchObject({ origin: "mcp", maxCredits: 21 });
    });

    it("explains a refusal in its own words", async () => {
      const { call } = await setup();
      const res = await call("run_marketing_style", { style_id: "nope", idempotency_key: "k2" });
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/list_marketing_styles/);
    });
  });

  describe("presets", () => {
    const photo = `/api/media/uploads/${ACC_1}/me.png`;
    const run = (over: Record<string, unknown> = {}) => ({ preset_id: "earth-zoom", image: photo, consent: true, max_credits: 12, idempotency_key: crypto.randomUUID(), ...over });

    it("lists the presets with the price of one run and never a recipe prompt", async () => {
      const { call } = await setup();
      const res = await call("list_presets");
      expect(res.structuredContent).toEqual({ presets: fakePresets.list() });
      expect(JSON.stringify(res)).not.toContain("SECRET");
    });

    it("starts a preset with the user's photo at the price shown, recorded for the key, showing the preset but not its prompt", async () => {
      const { call, repo, fake } = await setup();
      fake.next({ state: "completed", outputs: [{ contentType: "video/mp4", data: PNG }] });
      const res = await call("run_preset", run({ wish: "red cape", wait_seconds: 5 }));
      expect(res.isError).toBeFalsy();
      const job = res.structuredContent?.job as Record<string, any>;
      expect(job).toMatchObject({ job_type: "test_video", status: "succeeded", credits: 12, params: { recipe: { id: "earth-zoom", title: "Earth zoom", wish: "red cape" }, image: photo } });
      expect(JSON.stringify(res)).not.toContain("SECRET");
      const [record] = await repo.list(ACC_1);
      expect(record).toMatchObject({ origin: "mcp", apiKeyId: KEY_ID });
      expect(JSON.stringify(await call("list_jobs"))).not.toContain("SECRET");
      // The model gets the whole recipe prompt with the wish, the preset marker stays at home.
      expect(fake.requests[0]?.params.prompt).toBe(`${RECIPE_PROMPT} Additional wish: red cape`);
      expect(fake.requests[0]?.params).not.toHaveProperty("recipe");
    });

    it("starts nothing without the consent of the people in the photo", async () => {
      const { call, repo } = await setup();
      const res = await call("run_preset", run({ consent: false }));
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toMatch(/^consent_required: /);
      expect(await repo.list(ACC_1)).toEqual([]);
    });

    it("takes only the caller's own uploads as the photo", async () => {
      const { call, repo } = await setup();
      for (const image of [`/api/media/uploads/${ACC_2}/them.png`, "https://example.com/me.png"]) {
        const res = await call("run_preset", run({ image }));
        expect(res.content[0]!.text).toMatch(/^invalid_params: /);
      }
      expect(await repo.list(ACC_1)).toEqual([]);
    });

    it("keeps the price: a higher price starts nothing", async () => {
      const { call, repo } = await setup();
      const res = await call("run_preset", run({ max_credits: 10 }));
      expect(res.content[0]!.text).toMatch(/^price_changed: This job now costs 12 credits/);
      expect(await repo.list(ACC_1)).toEqual([]);
    });

    it("explains an unknown preset or one whose model is missing", async () => {
      const { call } = await setup();
      expect((await call("run_preset", run({ preset_id: "nope" }))).content[0]!.text).toMatch(/^unknown_preset: .*list_presets/);
      expect((await call("run_preset", run({ preset_id: "gone" }))).content[0]!.text).toMatch(/^unknown_preset: The preset "gone" .*list_presets/);
    });

    it("starts a retried call only once", async () => {
      const { call, repo } = await setup();
      const args = run();
      await call("run_preset", args);
      await call("run_preset", args);
      expect(await repo.list(ACC_1)).toHaveLength(1);
    });
  });

  describe("director", () => {
    const CUSTOM = { type: "custom" as const, jobType: "test_image", kind: "image" as const, model: "Test Image 1", prompt: "Tokyo in the rain, neon, 16:9", params: { prompt: "Tokyo in the rain, neon, 16:9", aspect_ratio: "16:9" }, why: "Kinolook in einem Bild.", credits: 4 };
    const PRESET = { type: "preset" as const, presetId: "superhero-pet", title: "Superhero", why: "Your dog flies.", wish: "red cape", credits: 45 };

    it("plans with the Director and hands back its reply and priced proposals, without starting anything", async () => {
      const director = fakeDirector(() => turn([
        { type: "text", delta: "Two ideas" },
        { type: "proposals", proposals: [CUSTOM, PRESET] },
        { type: "done", reply: "Two ideas for you." },
        { type: "budget", allowed: true, turnsLeft: 13, share: 0.75 },
      ]));
      const { call, repo } = await setup({ director: director.dep });
      const history = [{ role: "user", content: "Hello" }, { role: "assistant", content: "What are we making?" }];
      const res = await call("ask_director", { message: "A cinematic shot of Tokyo", history, model: "claude-sonnet-5-5" });

      expect(director.calls).toEqual([{ accountId: ACC_1, body: { history: [...history, { role: "user", content: "A cinematic shot of Tokyo" }], model: "claude-sonnet-5-5" }, key: { id: KEY_ID, dailyLimit: null } }]);
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent).toEqual({
        reply: "Two ideas for you.",
        model: "Claude Sonnet 5.5",
        proposals: [
          { type: "custom", job_type: "test_image", kind: "image", model: "Test Image 1", prompt: CUSTOM.prompt, params: CUSTOM.params, why: CUSTOM.why, credits: 4, start: "generate" },
          { type: "preset", preset_id: "superhero-pet", title: "Superhero", why: PRESET.why, wish: "red cape", credits: 45, start: "run_preset" },
        ],
        budget: { allowed: true, turns_left: 13, share_left: 0.75 },
      });
      expect(await repo.list(ACC_1)).toEqual([]);
    });

    it("hands back the short replies the user can send next, as the studio shows them", async () => {
      const director = fakeDirector(() => turn([
        { type: "proposals", proposals: [CUSTOM] },
        { type: "suggestions", suggestions: ["Make it darker", "9:16 for TikTok instead"] },
        { type: "done", reply: "I am making you a cinematic shot of Tokyo in the rain." },
      ]));
      const { call } = await setup({ director: director.dep });
      const res = await call("ask_director", { message: "A cinematic shot of Tokyo" });

      expect(res.structuredContent).toMatchObject({ suggestions: ["Make it darker", "9:16 for TikTok instead"] });
      expect(res.content[0]!.text).toMatch(/suggestions/);
    });

    it("passes the user's photo on and says what a message with one of the strongest models cost", async () => {
      const director = fakeDirector(() => turn([{ type: "proposals", proposals: [CUSTOM] }, { type: "done", reply: "With your photo." }, { type: "charged", credits: 16 }]));
      const { call } = await setup({ director: director.dep });
      const photo = `/api/media/uploads/${ACC_1}/dog.png`;
      const res = await call("ask_director", { message: "Mach was Virales", photo, model: "claude-opus-5-5" });

      expect(director.calls[0]!.body).toEqual({ history: [{ role: "user", content: "Mach was Virales" }], model: "claude-opus-5-5", photo });
      expect(res.structuredContent).toMatchObject({ reply: "With your photo.", charged: 16 });
      expect(res.structuredContent).not.toHaveProperty("budget");
      expect(res.content[0]!.text).toMatch(/16 credits/);
    });

    it("passes the Director's refusals on with their code and the reply for the user", async () => {
      for (const error of ["director_paid_only", "insufficient_credits", "director_budget", "foreign_input"]) {
        const director = fakeDirector(() => ({ ok: false, error, reply: `Reply to ${error}` }));
        const { call } = await setup({ director: director.dep });
        const res = await call("ask_director", { message: "Hello" });
        expect(res.isError).toBe(true);
        expect(res.content[0]!.text).toBe(`${error}: Reply to ${error}`);
      }
    });

    it("reports a turn that broke off", async () => {
      const director = fakeDirector(() => turn([{ type: "text", delta: "Moment" }, { type: "error", error: "director_unavailable", message: "x" }]));
      const { call } = await setup({ director: director.dep });
      const res = await call("ask_director", { message: "Hello" });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toMatch(/^director_unavailable: /);
    });

    it("stops a turn that takes too long as failed, so a paid message is not charged", async () => {
      let stopped: string | undefined;
      const director = fakeDirector(() => ({
        ok: true,
        model: { name: "Claude Opus 5.5" },
        events: (async function* () {
          yield { type: "text", delta: "Hmm" } as ClientEvent;
          await new Promise(() => {}); // never ends
        })(),
        stop: (reason) => void (stopped = reason ?? "left"),
      }));
      const { call } = await setup({ director: { ...director.dep, deadlineMs: 20 } });
      const res = await call("ask_director", { message: "Hello" });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toMatch(/^director_timeout: /);
      expect(stopped).toBe("failed");
    });

    it("lists the Director's models with what each costs today, without vendor ids or USD", async () => {
      const { call } = await setup();
      const res = await call("list_director_models");
      expect(res.structuredContent).toEqual({
        share_left: 0.8,
        paying: false,
        models: [
          { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", maker: "Anthropic", tier: "ausgewogen", default: true, paid: false, allowed: true, turns_left: 14 },
          { id: "claude-opus-5-5", name: "Claude Opus 5.5", maker: "Anthropic", tier: "beste", default: false, paid: true, credits: { typical: 16, cap: 35 }, allowed: false, locked: "purchase" },
        ],
      });
    });

    it("checks a request like POST /api/director before a turn starts: only the caller's own photo", async () => {
      const started: unknown[] = [];
      const keys: unknown[] = [];
      const wired = directorForMcp(async () => ({
        start: async (_accountId, input, _signal, key) => {
          started.push(input);
          keys.push(key);
          return turn([]) as never;
        },
        overview: async (_accountId, key) => {
          keys.push(key);
          return { share: 1, paying: false, models: [] };
        },
      }));
      const foreign = await wired.start(ACC_1, { history: [{ role: "user", content: "Hello" }], photo: `/api/media/uploads/${ACC_2}/x.png` });
      expect(foreign).toMatchObject({ ok: false, error: "foreign_input" });
      const unknown = await wired.start(ACC_1, { history: [{ role: "user", content: "Hello" }], model: "gpt-0" });
      expect(unknown).toMatchObject({ ok: false, error: "unknown_model" });
      expect(started).toEqual([]);
      const key = { id: KEY_ID, dailyLimit: 300 };
      await wired.start(ACC_1, { history: [{ role: "user", content: "Hello" }], photo: `/api/media/uploads/${ACC_1}/x.png` }, undefined, key);
      expect(started).toMatchObject([{ history: [{ role: "user", content: "Hello" }], photo: `/api/media/uploads/${ACC_1}/x.png`, hasPhoto: true }]);
      await wired.overview(ACC_1, key);
      expect(keys).toEqual([key, key]);
    });

    it("hands the key and its daily limit to the Director, which holds paid messages to it like jobs", async () => {
      const director = fakeDirector(() => ({ ok: false, error: "key_limit_reached", reply: "Limit erreicht.", limit: 300, used: 290 }));
      const { call } = await setup({ director: director.dep, dailyLimit: 300 });
      const res = await call("ask_director", { message: "Hello", model: "claude-opus-5-5" });
      expect(director.calls[0]!.key).toEqual({ id: KEY_ID, dailyLimit: 300 });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toBe("key_limit_reached: This key may spend 300 credits per 24 hours and 290 are used. The owner can raise the limit in Tevyon Studio → \"API & MCP\".");
      await call("list_director_models");
      expect(director.overviews).toEqual([{ accountId: ACC_1, key: { id: KEY_ID, dailyLimit: 300 } }]);
    });

    it("plans a campaign with the Marketing Agent: the brief goes to the agent, creatives come back ready for run_marketing_style", async () => {
      const CREATIVE = {
        type: "marketing" as const, styleId: "ad-claim", title: "Big claim", category: "ads" as const, kind: "image" as const, cover: "/marketing/x.webp",
        wish: "Fresher than ever", aspect: "9:16", caption: "New on the shelf #lemonade", why: "A clear claim for Stories", needs: [], lettering: true, spoken: false, credits: 12,
      };
      const director = fakeDirector(() => turn([{ type: "proposals", proposals: [CREATIVE, PRESET] }, { type: "done", reply: "Your plan." }]));
      const { call, repo } = await setup({ director: director.dep });
      const photo = `/api/media/uploads/${ACC_1}/lemonade.png`;
      const res = await call("ask_marketing_agent", { message: "Launch on Instagram", photo, has_avatar: false, product_name: "Organic lemonade" });
      expect(director.calls[0]!.body).toEqual({
        history: [{ role: "user", content: "Launch on Instagram" }], agent: "marketing", hasAvatar: false, photo, product: { name: "Organic lemonade", description: undefined },
      });
      expect(res.structuredContent).toMatchObject({
        reply: "Your plan.",
        creatives: [{ type: "marketing", style_id: "ad-claim", wish: "Fresher than ever", aspect: "9:16", caption: "New on the shelf #lemonade", needs: [], credits: 12, start: "run_marketing_style" }],
      });
      expect(await repo.list(ACC_1)).toEqual([]);
    });

    it("leaves the Director tools out when the server has no Director", async () => {
      const { client } = await setup({ director: null });
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).not.toContain("ask_director");
      expect(names).not.toContain("list_director_models");
      expect(names).not.toContain("ask_marketing_agent");
    });
  });

  describe("consent for jobs that show real people", () => {
    // A swap like Face Swap: two of the caller's pictures and consent: true, which an agent can type itself.
    const swapRegister = defineRegister([
      jobType({
        jobType: "test_swap", kind: "image", model: "Test Swap", tagline: "Test maker · face swap",
        params: z.object({ prompt: z.string().default(""), image: z.string(), face: z.string(), consent: z.literal(true) }),
        credits: () => 6,
        consentImages: (p) => [p.image, p.face],
        route: { provider: SECRET_ROUTE, providerModel: `${SECRET_ROUTE}/swap-z` },
      }),
    ]);
    const swapBook = defineSkills([{ name: "prompt-test-swap", version: "1.0.0", kind: "prompt", models: ["test_swap"], description: "Swap", body: "Swap.", rules: { maxChars: 500, minWords: 0, negations: "ok", slots: ["subject"] } }], swapRegister);
    const params = { image: `/api/media/uploads/${ACC_1}/target.png`, face: `/api/media/uploads/${ACC_1}/face.png`, consent: true };

    async function swapSetup() {
      const repo = createMemoryRepository();
      await repo.grant(ACC_1, 50, "grant_swap");
      const consent = createConsent({ store: createMemoryConsentStore() });
      const jobs = createJobs({
        register: swapRegister, repo, providers: { [SECRET_ROUTE]: createFakeProvider() }, media: createMemoryMediaStore("/api/media"),
        prompting: createPrompting({ register: swapRegister, skills: swapBook }), consent,
      });
      const client = await connect(createTachyonMcpServer({
        register: swapRegister, jobs, balance: (id) => repo.balance(id), statement: (id) => createCredits(repo).statement(id), account: { id: ACC_1 },
        link: (u) => u, consent: { request: (a, j, p) => requestConsent(swapRegister, consent, a, j, p), url: (id) => `https://app.tachyon.test/consent/${id}` },
      }));
      const call = async (name: string, args: Record<string, unknown>) =>
        (await client.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent?: Record<string, any>; content: Record<string, any>[] };
      return { call, consent };
    }

    it("asks the person to confirm in Tevyon before a swap starts, then starts it once", async () => {
      const { call, consent } = await swapSetup();
      const bare = await call("generate", { idempotency_key: "s1", job_type: "test_swap", params });
      expect(bare.isError).toBe(true);
      expect(text(bare)).toMatch(/^consent_required: .*request_consent/);

      const req = await call("request_consent", { job_type: "test_swap", params });
      expect(req.structuredContent).toMatchObject({ consent_id: expect.any(String), confirm_url: expect.stringMatching(/^https:\/\/app\.tachyon\.test\/consent\//) });
      expect(text(req)).toMatch(/confirm_url/);
      const id = req.structuredContent?.consent_id as string;

      expect(text(await call("generate", { idempotency_key: "s1", job_type: "test_swap", params, consent_id: id }))).toMatch(/^consent_pending/);
      await consent.confirm(ACC_1, id);
      const started = await call("generate", { idempotency_key: "s1", job_type: "test_swap", params, consent_id: id });
      expect(started.isError).toBeFalsy();
      expect(text(await call("generate", { idempotency_key: "s2", job_type: "test_swap", params, consent_id: id }))).toMatch(/^consent_used/);
    });

    it("needs the caller's own pictures and a model that shows people", async () => {
      const { call } = await swapSetup();
      const foreign = await call("request_consent", { job_type: "test_swap", params: { ...params, face: `/api/media/uploads/${ACC_2}/face.png` } });
      expect(text(foreign)).toMatch(/^invalid_params/);
      expect(text(await call("request_consent", { job_type: "nope", params }))).toMatch(/^unknown_job_type/);
    });
  });

  it("keeps the skills on the server: no skill tool, no skill name, prompts written by Tevyon by default", async () => {
    const { call, client, fake, results } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of ["list_skills", "get_skill", "get_skill_file"]) expect(names).not.toContain(tool);
    expect(client.getInstructions()).not.toMatch(/skill/i);
    expect(client.getInstructions()).toMatch(/prompt_mode "auto"/);
    fake.next({ state: "completed", outputs: [{ contentType: "image/png", data: PNG }] });
    await call("list_models");
    await call("get_price", { job_type: "test_image", params: { prompt: "a fox" } });
    await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "a fox" }, wait_seconds: 5 });
    expect(JSON.stringify(results)).not.toMatch(/prompt-test-|prompt_skill/);
  });

  it("never reveals the purchase route, the vendor model or vendor messages", async () => {
    const { call, fake, results } = await setup();
    fake.next({ state: "failed", reason: "moderated", detail: `${SECRET_ROUTE} says: flagged` });
    await call("list_models");
    await call("get_price", { job_type: "test_image", params: { prompt: "a fox" } });
    const res = await call("generate", { idempotency_key: crypto.randomUUID(), job_type: "test_image", params: { prompt: "a fox" }, wait_seconds: 5 });
    await call("get_job", { job_id: (res.structuredContent?.job as Record<string, any>).id });
    await call("list_jobs");
    await call("get_price", { job_type: "nope", params: {} });
    expect(JSON.stringify(results)).not.toContain(SECRET_ROUTE);
  });

  it("keeps the real catalog's purchase routes out of list_models", async () => {
    const files = loadSkills(SKILLS_DIR);
    const realBook = defineSkills(files.skills, catalog);
    const repo = createMemoryRepository();
    const jobs = createJobs({
      register: catalog, repo, providers: {}, media: createMemoryMediaStore("/api/media"),
      prompting: createPrompting({ register: catalog, skills: realBook }),
    });
    const client = await connect(createTachyonMcpServer({
      register: catalog, jobs, balance: (id) => repo.balance(id), statement: (id) => createCredits(repo).statement(id), account: { id: ACC_1 }, link: (u) => u,
      promptMax: (jobType) => realBook.promptSkillFor(jobType, catalog.get(jobType)?.family).rules?.maxChars,
    }));
    const listed = await client.callTool({ name: "list_models", arguments: {} });
    const res = JSON.stringify(listed);
    expect(res).toContain(catalog.list()[0]?.model);
    expect(res.toLowerCase()).not.toContain("comfy");
    for (const def of catalog.list()) expect(res).not.toContain(def.route.providerModel);
    // Every model publishes the prompt limit its skill enforces.
    const models = (listed.structuredContent as { models: { job_type: string; parameters: { properties: Record<string, { maxLength?: number }> } }[] }).models;
    expect(models.filter((m) => typeof m.parameters.properties.prompt?.maxLength !== "number").map((m) => m.job_type)).toEqual([]);
    expect(models.find((m) => m.job_type === "kling_3_turbo")?.parameters.properties.prompt?.maxLength).toBe(2500);
  });
});
