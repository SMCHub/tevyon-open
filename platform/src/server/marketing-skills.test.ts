import { describe, expect, it } from "vitest";
import { catalog } from "../core/catalog";
import { composeMarketingJob, composeUgcVideo, findStyle, flowRules, MS_STYLES, MS_TEMPLATES, styleAvailable, type MsInputs } from "../core/marketing";
import { createPrompting } from "../core/prompting";
import { defineSkills } from "../core/skills";
import { loadSkills, SKILLS_DIR } from "./skill-files";

/**
 * Marketing Agent styles start with promptMode "exact" like presets: the prompt-skill duty is met at build time.
 * Every style, with and without an avatar, ad reference and wish, passes the check of its model's skill.
 */
const prompting = createPrompting({ register: catalog, skills: defineSkills(loadSkills(SKILLS_DIR).skills, catalog) });
const has = (jobType: string) => catalog.get(jobType) !== undefined;
const PRODUCT = "/api/media/uploads/00000000-0000-4000-8000-000000000001/prod.jpg";
const AVATAR = "/api/media/uploads/00000000-0000-4000-8000-000000000001/face.jpg";
const AD_REF = "/api/media/uploads/00000000-0000-4000-8000-000000000001/ref.png";
const FORBIDDEN = new Set(["negation", "camera_missing", "text_unquoted"]);

const live = [...MS_STYLES, ...MS_TEMPLATES.map((t) => findStyle(t.id)!)].filter((s) => styleAvailable(s, has));

function variants(flow: Parameters<typeof flowRules>[0]): MsInputs[] {
  const r = flowRules(flow);
  const base: MsInputs = { product: PRODUCT, ...(r.avatar === "required" ? { avatar: AVATAR } : {}), ...(flow === "ugc" ? { wish: "Das benutze ich jeden Tag" } : {}) };
  const out: MsInputs[] = [base, { ...base, wish: "Fresher than ever" }];
  if (r.avatar === "optional") out.push({ ...base, avatar: AVATAR });
  if (r.adReference) out.push({ ...base, adReference: AD_REF });
  if (flow === "poster" || flow === "motion") out.push({ wish: "Organic ginger lemonade in a glass bottle" });
  return out;
}

describe("marketing agent styles follow the prompt skill of their model", () => {
  it.each(live.map((s) => [s.id, s] as const))("%s passes its skill check in every variant", (_id, s) => {
    for (const inputs of variants(s.flow)) {
      const res = composeMarketingJob(s.id, inputs, has);
      if (!res.ok) throw new Error(`${s.id}: ${res.error}`);
      const notes = prompting.check(res.jobType, res.params).notes.filter((n) => n.level === "warn" || FORBIDDEN.has(n.code));
      expect(notes.map((n) => n.code), `${s.id} ${JSON.stringify(inputs)}`).toEqual([]);
    }
  });

  it.each(live.filter((s) => s.flow === "motion").map((s) => [s.id, s] as const))("%s describes its sound", (_id, s) => {
    const res = composeMarketingJob(s.id, variants(s.flow)[0]!, has);
    if (!res.ok) throw new Error(res.error);
    expect(String(res.params.prompt)).toMatch(/sound|music|ambien|voice|says/i);
  });

  it.each(live.filter((s) => s.flow === "ugc").map((s) => [s.id, s] as const))("%s: step 2 passes the video skill, speaks and has sound", (_id, s) => {
    const res = composeUgcVideo(s.id, { frame: AVATAR, wish: "Das benutze ich jeden Tag, ehrlich", duration: 8 }, has);
    if (!res.ok) throw new Error(res.error);
    const notes = prompting.check(res.jobType, res.params).notes.filter((n) => n.level === "warn" || FORBIDDEN.has(n.code));
    expect(notes.map((n) => n.code)).toEqual([]);
    expect(String(res.params.prompt)).toMatch(/says/);
    expect(String(res.params.prompt)).toMatch(/(SFX|Ambient noise|Music):/);
    expect(String(res.params.prompt)).not.toMatch(/["“”„«»]/);
  });

  it("there are live styles in every category", () => {
    for (const c of ["ugc", "product", "motion", "ads", "posters", "marketplace"]) expect(live.some((s) => s.category === c), c).toBe(true);
  });
});
