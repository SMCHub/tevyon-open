import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JobView } from "./jobs";
import { RETRY_MS, createMemoryWebhookStore, createPostgresWebhookStore, createWebhooks, type WebhookStore } from "./webhooks";
import { pgliteDb } from "./testing/repositories";

const LENA = "00000000-0000-4000-8000-00000000000a";
const JOB = "10000000-0000-4000-8000-000000000001";
const SECRET = "whsec_test";

const stores: [string, () => Promise<WebhookStore>][] = [
  ["memory", async () => createMemoryWebhookStore()],
  ["postgres", async () => createPostgresWebhookStore(await pgliteDb())],
];

function setup(store: WebhookStore) {
  let clock = Date.UTC(2026, 9, 15, 21);
  const jobs = new Map<string, JobView>();
  const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
  let answer: { ok: boolean; status?: number } = { ok: true, status: 200 };
  const webhooks = createWebhooks({
    store,
    now: () => clock,
    getJob: async (accountId, jobId) => (accountId === LENA ? jobs.get(jobId) : undefined),
    secretFor: () => SECRET,
    link: (url, base) => `${base}${url}?sig=signed`,
    send: async (url, body, headers) => {
      sent.push({ url, body, headers });
      return answer;
    },
  });
  const job = (status: JobView["status"], extra: Partial<JobView> = {}) =>
    jobs.set(JOB, { id: JOB, jobType: "test_image", model: "Test Image", status, credits: 4, outputs: [], params: { prompt: "a fox" }, createdAt: clock, ...extra });
  return { webhooks, job, sent, later: (ms: number) => (clock += ms), answer: (a: typeof answer) => (answer = a) };
}

describe.each(stores)("%s webhooks", (_name, makeStore) => {
  it("posts a finished job once, signed with the account's secret, in Tevyon's words and with signed links", async () => {
    const { webhooks, job, sent } = setup(await makeStore());
    await webhooks.register(JOB, LENA, "https://hooks.example.com/tevyon", "https://app.tevyon.test");
    job("running");
    expect(await webhooks.dispatch()).toEqual({ sent: 0 });
    job("succeeded", { outputs: [{ url: "/api/media/job/0.png", contentType: "image/png" }] });
    expect(await webhooks.dispatch()).toEqual({ sent: 1 });
    expect(await webhooks.dispatch()).toEqual({ sent: 0 });

    const [hit] = sent;
    expect(hit!.url).toBe("https://hooks.example.com/tevyon");
    const body = JSON.parse(hit!.body);
    expect(body).toMatchObject({
      type: "job.finished",
      job: { id: JOB, job_type: "test_image", model: "Test Image", status: "succeeded", credits: 4, outputs: [{ url: "https://app.tevyon.test/api/media/job/0.png?sig=signed", content_type: "image/png" }] },
    });
    // t=<seconds>,v1=<HMAC-SHA256 of "t.body">, so a receiver can check it and reject old copies.
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(hit!.headers["x-tevyon-signature"]!)!;
    expect(v1).toBe(createHmac("sha256", SECRET).update(`${t}.${hit!.body}`).digest("hex"));
    expect(hit!.headers["x-tevyon-event"]).toBe("job.finished");
  });

  it("tries again later when the receiver fails, and gives up after the last try", async () => {
    const { webhooks, job, sent, later, answer } = setup(await makeStore());
    await webhooks.register(JOB, LENA, "https://hooks.example.com/x", "https://app.tevyon.test");
    job("failed", { error: "content_moderated" });
    answer({ ok: false, status: 500 });
    for (const wait of RETRY_MS) {
      expect(await webhooks.dispatch()).toEqual({ sent: 1 });
      expect(await webhooks.dispatch()).toEqual({ sent: 0 });
      later(wait);
    }
    expect(await webhooks.dispatch()).toEqual({ sent: 1 });
    later(24 * 3600_000);
    expect(await webhooks.dispatch()).toEqual({ sent: 0 });
    expect(sent).toHaveLength(RETRY_MS.length + 1);
    expect(JSON.parse(sent[0]!.body).job.error).toEqual({ code: "content_moderated" });
  });

  it("registers a job once and never posts another account's job", async () => {
    const { webhooks, job, sent } = setup(await makeStore());
    await webhooks.register(JOB, LENA, "https://hooks.example.com/a", "https://app.tevyon.test");
    await webhooks.register(JOB, LENA, "https://hooks.example.com/b", "https://app.tevyon.test");
    await webhooks.register("10000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-00000000000b", "https://hooks.example.com/c", "https://app.tevyon.test");
    job("succeeded");
    await webhooks.dispatch();
    expect(sent.map((s) => s.url)).toEqual(["https://hooks.example.com/a"]);
  });
});
