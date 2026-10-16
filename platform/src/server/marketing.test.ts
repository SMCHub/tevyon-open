import { describe, expect, it } from "vitest";
import { catalog } from "../core/catalog";
import { createJobs } from "../core/jobs";
import { createMemoryMediaStore } from "../core/media";
import { MS_STYLES } from "../core/marketing";
import { createPrompting } from "../core/prompting";
import { createMemoryRepository } from "../core/repository";
import { defineSkills } from "../core/skills";
import { createFakeProvider } from "../core/testing/fake-provider";
import { continueUgc, marketingOverview, marketingQuote, startMarketing } from "./marketing";
import { loadSkills, SKILLS_DIR } from "./skill-files";

const ACC = "00000000-0000-4000-8000-000000000001";
const PRODUCT = `/api/media/uploads/${ACC}/prod.jpg`;
const AVATAR = `/api/media/uploads/${ACC}/face.jpg`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function setup(credits = 1000) {
  const repo = createMemoryRepository();
  await repo.grant(ACC, credits, "test:grant");
  const prompting = createPrompting({ register: catalog, skills: defineSkills(loadSkills(SKILLS_DIR).skills, catalog) });
  const fake = createFakeProvider();
  const store = createMemoryMediaStore("/api/media");
  const jobs = createJobs({ register: catalog, repo, providers: { comfy: fake }, media: store, prompting });
  // The runtime's media reads by key (without /api/media/), like the file store.
  const media = { put: (key: string, data: Uint8Array, type: string) => store.put(`${key}.${type === "image/png" ? "png" : "jpg"}`, data, type), read: async (key: string) => { const data = store.read(`/api/media/${key}`); return data ? { data, contentType: "image/png" } : undefined; } };
  const rt = { jobs, media, models: { availability: () => ({ ok: true }) } } as unknown as Parameters<typeof marketingOverview>[0];
  return { rt, repo, jobs, fake };
}

const productShot = MS_STYLES.find((s) => s.flow === "product_shots")!;
const people = MS_STYLES.find((s) => s.flow === "product_shots_people")!;
const poster = MS_STYLES.find((s) => s.flow === "poster")!;
const motion = MS_STYLES.find((s) => s.flow === "motion")!;

describe("marketing agent server", () => {
  it("lists every style with a price, without prompts", async () => {
    const { rt } = await setup();
    const o = marketingOverview(rt);
    expect(o.categories).toHaveLength(6);
    expect(JSON.stringify(o)).not.toContain(productShot.prompt.slice(0, 30));
    const shot = o.styles.find((s) => s.id === productShot.id)!;
    expect(shot.credits).toBeGreaterThan(0);
    expect(o.styles.every((s) => s.credits !== null && s.credits > 0)).toBe(true);
  });

  it("prices motion by its duration", async () => {
    const { rt } = await setup();
    const five = marketingQuote(rt, motion.id, { product: true, duration: 5 });
    const fifteen = marketingQuote(rt, motion.id, { product: true, duration: 15 });
    if (!five.ok || !fifteen.ok) throw new Error("quote failed");
    expect(fifteen.credits).toBeGreaterThan(five.credits);
  });

  it("starts a batch as separate jobs, each tagged with its style and never showing the prompt", async () => {
    const { rt, jobs } = await setup();
    const res = await startMarketing(rt, ACC, { styleId: productShot.id, product: PRODUCT, count: 3 }, { idempotencyKey: "k1" });
    if (!res.ok) throw new Error(res.error);
    expect(res.jobs).toHaveLength(3);
    const view = await jobs.get(ACC, res.jobs[0]!.id);
    expect(view?.params).toMatchObject({ recipe: { id: `ms:${productShot.id}` } });
    expect(view?.params).not.toHaveProperty("prompt");
    // The same key again returns the same jobs (idempotent per run).
    const again = await startMarketing(rt, ACC, { styleId: productShot.id, product: PRODUCT, count: 3 }, { idempotencyKey: "k1" });
    if (!again.ok) throw new Error(again.error);
    expect(again.jobs.map((j) => j.id)).toEqual(res.jobs.map((j) => j.id));
  });

  it("tags each job with the run's inputs, so “Again” and “Adjust” can repeat it without the prompt", async () => {
    const { rt, jobs } = await setup();
    const res = await startMarketing(rt, ACC, { styleId: people.id, product: PRODUCT, avatar: AVATAR, consent: true, wish: "Sommer", aspect: "9:16", count: 2 }, {});
    if (!res.ok) throw new Error(res.error);
    const view = await jobs.get(ACC, res.jobs[1]!.id);
    expect(view?.params.recipe).toEqual({
      id: `ms:${people.id}`, title: `Marketing Agent · ${people.title}`, wish: "Sommer",
      inputs: { product: PRODUCT, avatar: AVATAR, aspect: "9:16", count: 2 },
    });
  });

  it("refuses a batch beyond 4 or on posters", async () => {
    const { rt } = await setup();
    expect(await startMarketing(rt, ACC, { styleId: productShot.id, product: PRODUCT, count: 5 }, {})).toEqual({ ok: false, error: "batch_size_invalid" });
    expect(await startMarketing(rt, ACC, { styleId: poster.id, product: PRODUCT, count: 2 }, {})).toEqual({ ok: false, error: "batch_size_invalid" });
  });

  it("needs consent for an avatar (a real person)", async () => {
    const { rt } = await setup();
    expect(await startMarketing(rt, ACC, { styleId: people.id, product: PRODUCT, avatar: AVATAR }, {})).toEqual({ ok: false, error: "consent_required" });
    const ok = await startMarketing(rt, ACC, { styleId: people.id, product: PRODUCT, avatar: AVATAR, consent: true }, {});
    expect(ok.ok).toBe(true);
  });

  it("only takes the caller's own uploads", async () => {
    const { rt } = await setup();
    const res = await startMarketing(rt, ACC, { styleId: productShot.id, product: "/api/media/uploads/00000000-0000-4000-8000-000000000009/x.jpg" }, {});
    expect(res).toMatchObject({ ok: false, error: "invalid_params" });
  });

  it("keeps the price guarantee per run", async () => {
    const { rt } = await setup();
    const res = await startMarketing(rt, ACC, { styleId: productShot.id, product: PRODUCT }, { maxCredits: 1 });
    expect(res).toMatchObject({ ok: false, error: "price_changed" });
  });

  it("returns the jobs already started when the credits run out mid-batch", async () => {
    const { rt } = await setup();
    const one = marketingQuote(rt, productShot.id, { product: true });
    if (!one.ok) throw new Error(one.error);
    const { rt: poor } = await setup(one.credits * 2);
    const res = await startMarketing(poor, ACC, { styleId: productShot.id, product: PRODUCT, count: 4 }, {});
    expect(res).toMatchObject({ ok: true, partial: "insufficient_credits" });
    if (res.ok) expect(res.jobs).toHaveLength(2);
  });

  describe("UGC chain", () => {
    const ugc = MS_STYLES.find((s) => s.flow === "ugc")!;
    const body = { styleId: ugc.id, product: PRODUCT, avatar: AVATAR, consent: true, wish: "My favourite", duration: 8 };

    it("prices both steps together", async () => {
      const { rt } = await setup();
      const q = marketingQuote(rt, ugc.id, { product: true, avatar: true, duration: 8 });
      if (!q.ok || !("parts" in q) || !q.parts) throw new Error("no parts");
      expect(q.credits).toBe(q.parts.frame + q.parts.video);
    });

    it("starts the still, then the video exactly once from it", async () => {
      const { rt, jobs, fake } = await setup();
      const q = marketingQuote(rt, ugc.id, { product: true, avatar: true, duration: 8 });
      if (!q.ok) throw new Error(q.error);
      const first = await startMarketing(rt, ACC, body, { maxCredits: q.credits });
      if (!first.ok) throw new Error(first.error);
      expect(first.next).toMatchObject({ styleId: ugc.id, duration: 8, aspect: "9:16" });
      const frameId = first.jobs[0]!.id;

      // Not done yet: no video.
      expect(await continueUgc(rt, ACC, { frameJobId: frameId, styleId: ugc.id, wish: "My favourite", duration: 8 }, {})).toEqual({ ok: false, error: "frame_not_ready" });

      fake.next({ state: "completed", outputs: [{ contentType: "image/png", data: PNG }] });
      await jobs.tick();
      const second = await continueUgc(rt, ACC, { frameJobId: frameId, styleId: ugc.id, wish: "My favourite", duration: 8 }, {});
      if (!second.ok) throw new Error(second.error);
      const video = await jobs.get(ACC, second.job.id);
      expect(video?.jobType).toBe("veo_3_1_lite");
      expect(String(video?.params.image)).toMatch(new RegExp(`^/api/media/uploads/${ACC}/`));
      const again = await continueUgc(rt, ACC, { frameJobId: frameId, styleId: ugc.id, wish: "My favourite", duration: 8 }, {});
      if (!again.ok) throw new Error(again.error);
      expect(again.job.id).toBe(second.job.id);
    });

    it("refuses a still of another style or account", async () => {
      const { rt } = await setup();
      const other = await startMarketing(rt, ACC, { styleId: productShot.id, product: PRODUCT }, {});
      if (!other.ok) throw new Error(other.error);
      expect(await continueUgc(rt, ACC, { frameJobId: other.jobs[0]!.id, styleId: ugc.id, wish: "x" }, {})).toEqual({ ok: false, error: "not_found" });
      expect(await continueUgc(rt, "00000000-0000-4000-8000-000000000002", { frameJobId: other.jobs[0]!.id, styleId: productShot.id, wish: "x" }, {})).toEqual({ ok: false, error: "not_found" });
    });
  });
});
