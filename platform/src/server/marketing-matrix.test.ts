import { describe, expect, it } from "vitest";
import { catalog } from "../core/catalog";
import { createJobs } from "../core/jobs";
import { createMemoryMediaStore } from "../core/media";
import { composeMarketingJob, composeUgcVideo, findStyle, flowRules, MS_STYLES, MS_TEMPLATES, type MsInputs, type MsStyle } from "../core/marketing";
import { createPrompting } from "../core/prompting";
import { createMemoryRepository } from "../core/repository";
import { defineSkills } from "../core/skills";
import { createFakeProvider } from "../core/testing/fake-provider";
import { marketingOverview, marketingQuote, startMarketing, type MsShape } from "./marketing";
import { loadSkills, SKILLS_DIR } from "./skill-files";

/**
 * Every style and every template with every combination the builder can send (product, avatar, ad reference, text,
 * format, length): the job its model accepts, the files in the order the prompt names them, no placeholder left, the
 * text where the style puts it, and the price the panel shows (quote with files by presence) equal to the price the
 * start charges. A mismatch there would refuse every start with price_changed.
 */
const ACC = "00000000-0000-4000-8000-0000000000a1";
const PRODUCT = `/api/media/uploads/${ACC}/product.jpg`;
const AVATAR = `/api/media/uploads/${ACC}/avatar.jpg`;
const REF = `/api/media/uploads/${ACC}/reference.png`;
const WISH = "Fresher than ever";
const has = (jobType: string) => catalog.get(jobType) !== undefined;

async function setup() {
  const repo = createMemoryRepository();
  await repo.grant(ACC, 1_000_000, "test:grant");
  const prompting = createPrompting({ register: catalog, skills: defineSkills(loadSkills(SKILLS_DIR).skills, catalog) });
  const jobs = createJobs({ register: catalog, repo, providers: { comfy: createFakeProvider() }, media: createMemoryMediaStore("/api/media"), prompting });
  const rt = { jobs, models: { availability: () => ({ ok: true }) } } as unknown as Parameters<typeof marketingOverview>[0];
  return { rt, jobs };
}

const all: MsStyle[] = [...MS_STYLES, ...MS_TEMPLATES.map((t) => findStyle(t.id)!)];

/** The inputs a builder can send for a style, each with the quote shape the panel asks with. */
function combos(s: MsStyle): { inputs: MsInputs; shape: MsShape }[] {
  const r = flowRules(s.flow);
  const opt = <T,>(need: string, v: T): (T | undefined)[] => (need === "required" ? [v] : need === "optional" ? [v, undefined] : [undefined]);
  const aspects = r.aspects.length ? r.aspects : [undefined];
  const durations = r.duration ? (r.duration.steps ?? Array.from({ length: r.duration.max - r.duration.min + 1 }, (_, i) => r.duration!.min + i)) : [undefined];
  const out: { inputs: MsInputs; shape: MsShape }[] = [];
  for (const product of opt(r.product, PRODUCT))
    for (const avatar of opt(r.avatar, AVATAR))
      for (const adReference of r.adReference ? [REF, undefined] : [undefined])
        for (const wish of s.flow === "ugc" ? [WISH] : [WISH, undefined])
          for (const aspect of aspects)
            for (const duration of durations) {
              // Posters and motion without a product need a description, like the panel says.
              if ((s.flow === "poster" || s.flow === "motion") && !product && !wish) continue;
              const inputs: MsInputs = { product, avatar, adReference, wish, aspect, duration };
              for (const k of Object.keys(inputs) as (keyof MsInputs)[]) if (inputs[k] === undefined) delete inputs[k];
              // What marketing-agent.tsx sends to /api/marketing/quote for these settings.
              const shape: MsShape = {
                product: Boolean(product) || r.product === "required", avatar: Boolean(avatar), adReference: Boolean(adReference),
                ...(aspect ? { aspect } : {}), ...(duration !== undefined ? { duration } : {}),
              };
              out.push({ inputs, shape });
            }
  return out;
}

describe("marketing agent: every style and template with every input", () => {
  it.each(all.map((s) => [s.id, s] as const))("%s builds the right job at the price it shows", async (_id, s) => {
    const { rt } = await setup();
    const r = flowRules(s.flow);
    for (const { inputs, shape } of combos(s)) {
      const label = `${s.id} ${JSON.stringify(inputs)}`;
      const job = composeMarketingJob(s.id, inputs, has);
      if (!job.ok) throw new Error(`${label}: ${job.error}`);
      const parsed = catalog.get(job.jobType)!.params.safeParse(job.params);
      expect(parsed.success, `${label}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
      const prompt = String(job.params.prompt);
      expect(prompt, label).not.toMatch(/\{(product|model|headline|line)\}/);
      expect(prompt, label).not.toMatch(/\s{2,}/);

      if (r.kind === "image") {
        // Files in the order the prompt names them: product, avatar, ad reference.
        const want = [inputs.product, s.flow === "ugc" ? undefined : inputs.avatar, inputs.adReference].filter(Boolean);
        if (s.flow === "ugc") expect(job.params.references, label).toEqual([PRODUCT, AVATAR]);
        else expect(job.params.references, label).toEqual(want);
        if (s.flow !== "ugc") {
          want.forEach((u, i) => {
            if (u === PRODUCT) expect(prompt, label).toContain(`product from image ${i + 1}`);
            if (u === AVATAR) expect(prompt, label).toContain(`person from image ${i + 1}`);
            if (u === REF) expect(prompt, label).toContain(`palette and mood from image ${i + 1}`);
          });
          if (!inputs.product) expect(prompt, label).toContain(`the product described as "${WISH}"`);
          if (inputs.wish && inputs.product) {
            expect(prompt.includes(`"${WISH}"`) || prompt.includes(`Additional wish: ${WISH}`), `${label}: wish lost`).toBe(true);
          }
        }
        expect(job.params.aspect_ratio, label).toBe(inputs.aspect ?? s.aspect);
      } else if (s.flow === "motion") {
        expect(job.params.image, label).toBe(inputs.product);
        expect(job.params.duration, label).toBe(inputs.duration);
        expect(job.params.aspect_ratio, label).toBe(inputs.aspect ?? s.aspect);
        if (inputs.wish) expect(prompt, label).toContain(WISH);
      }

      // The price the panel shows is the price the start checks.
      const shown = marketingQuote(rt, s.id, shape);
      if (!shown.ok) throw new Error(`${label}: quote ${shown.error}`);
      const real = rt.jobs.quote(job.jobType, job.params);
      if (!real.ok) throw new Error(`${label}: real quote ${real.error}`);
      let total = real.credits;
      if (job.next) {
        const video = composeUgcVideo(s.id, { frame: PRODUCT, wish: job.next.line, duration: job.next.duration, aspect: job.next.aspect }, has);
        if (!video.ok) throw new Error(`${label}: video ${video.error}`);
        expect(String(video.params.prompt), label).toContain(WISH);
        expect(video.params.duration, label).toBe(inputs.duration);
        expect(video.params.aspect_ratio, label).toBe(inputs.aspect ?? s.aspect);
        const v = rt.jobs.quote(video.jobType, video.params);
        if (!v.ok) throw new Error(`${label}: video quote ${v.error}`);
        total += v.credits;
      }
      expect(shown.credits, `${label}: shown ${shown.credits}, charged ${total}`).toBe(total);
    }
  });

  it.each(all.map((s) => [s.id, s] as const))("%s starts with the full input at the shown price and tags the run", async (_id, s) => {
    const { rt, jobs } = await setup();
    const list = combos(s);
    // The richest combination (every file the style takes) and the leanest one.
    for (const { inputs, shape } of [list[0]!, list.at(-1)!]) {
      const q = marketingQuote(rt, s.id, shape);
      if (!q.ok) throw new Error(q.error);
      const res = await startMarketing(rt, ACC, { styleId: s.id, ...inputs, consent: true, count: 1, maxCredits: q.credits }, {});
      if (!res.ok) throw new Error(`${s.id} ${JSON.stringify(inputs)}: ${res.error}`);
      const view = await jobs.get(ACC, res.jobs[0]!.id);
      const tag = view!.params.recipe as { id: string; wish?: string; inputs?: Record<string, unknown> };
      expect(tag.id).toBe(`ms:${s.id}`);
      if (inputs.wish) expect(tag.wish).toBe(inputs.wish);
      for (const k of ["product", "avatar", "adReference", "aspect", "duration"] as const) expect(tag.inputs?.[k], `${s.id} tag ${k}`).toBe(inputs[k]);
    }
  });
});
