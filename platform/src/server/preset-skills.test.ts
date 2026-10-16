import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalog } from "../core/catalog";
import { createPrompting } from "../core/prompting";
import { composeRecipeJob, DRAFT_RECIPES, RECIPES, type Recipe } from "../core/recipes";
import { defineSkills } from "../core/skills";
import { loadSkills, SKILLS_DIR } from "./skill-files";

/**
 * Presets start with promptMode "exact": no writer touches the recipe prompt at runtime. So the prompt-skill duty
 * (every job through its model's skill) is met here, at build time: each recipe prompt is written to the rules of
 * the skill its model runs through, and this test proves it with the same check the quote shows users.
 */
const prompting = createPrompting({ register: catalog, skills: defineSkills(loadSkills(SKILLS_DIR).skills, catalog) });
const PHOTO = "/api/media/uploads/00000000-0000-4000-8000-000000000001/a1b2.jpg";
/** Notes a recipe must never get: every warning, plus the hints that mean the prompt ignores the skill's shape. */
const FORBIDDEN = new Set(["negation", "camera_missing", "text_unquoted"]);

/** Live presets and drafts alike: a draft is written to its skill before anyone pays for its preview. */
const ALL: Recipe[] = [...RECIPES, ...DRAFT_RECIPES];
const byId = new Map(ALL.map((r) => [r.id, r]));
const SAMPLE_LINE = "Happy birthday, Lena!";

function job(id: string, wish?: string) {
  const r = byId.get(id)!;
  const res = composeRecipeJob(r, { image: PHOTO, wish: wish ?? (r.line ? SAMPLE_LINE : undefined) });
  if (!res.ok) throw new Error(`${id}: ${res.error}`);
  return res;
}

describe("presets follow the prompt skill of their model", () => {
  it.each(ALL.map((r) => [r.id, r] as const))("%s passes its skill check", (id) => {
    const { jobType, params } = job(id);
    const notes = prompting.check(jobType, params).notes.filter((n) => n.level === "warn" || FORBIDDEN.has(n.code));
    expect(notes.map((n) => n.code)).toEqual([]);
  });

  it.each(ALL.filter((r) => r.params.generate_audio === true).map((r) => [r.id, r] as const))(
    "%s describes its sound, since the sound is on",
    (id) => {
      const { jobType, params } = job(id);
      const prompt = String(params.prompt);
      // prompt-veo: audio in separate sentences at the end ("SFX: …", "Ambient noise: …", "Music: …").
      if (prompting.skillOf(jobType).startsWith("prompt-veo@")) expect(prompt).toMatch(/(SFX|Ambient noise|Music):/);
      // prompt-kling: effects, ambience and music in plain words.
      else expect(prompt).toMatch(/sound|music|ambien|SFX|voice|says/i);
    },
  );

  it.each(ALL.filter((r) => r.jobType.startsWith("veo_")).map((r) => [r.id, r] as const))(
    "%s has no quote marks for Veo (quoted text can appear as on-screen text)",
    (id) => {
      expect(String(job(id).params.prompt)).not.toMatch(/["“”„«»]/);
    },
  );

  it("still passes with a typical wish of a user", () => {
    for (const r of ALL) {
      const { jobType, params } = job(r.id, "with sunglasses, on the beach at sunset");
      const warns = prompting.check(jobType, params).notes.filter((n) => n.level === "warn");
      expect(warns.map((n) => n.code), r.id).toEqual([]);
    }
  });

  it("ids are unique across live presets and drafts", () => {
    expect(byId.size).toBe(ALL.length);
  });
});

describe("spoken lines", () => {
  const lineRecipes = ALL.filter((r) => r.line);

  it("needs the line and sets it into the prompt as spoken words, without quote marks", () => {
    for (const r of lineRecipes) {
      expect(composeRecipeJob(r, { image: PHOTO })).toEqual({ ok: false, error: "line_required" });
      const res = composeRecipeJob(r, { image: PHOTO, wish: '  "Freshly roasted"  ' });
      if (!res.ok) throw new Error(res.error);
      const prompt = String(res.params.prompt);
      expect(prompt, r.id).toContain("says");
      expect(prompt, r.id).toContain("Freshly roasted.");
      expect(prompt, r.id).not.toContain("{line}");
      expect(prompt, r.id).not.toMatch(/["“”„«»]/);
    }
  });

  it("keeps the line short enough for the clip", () => {
    for (const r of lineRecipes) {
      const res = composeRecipeJob(r, { image: PHOTO, wish: "word ".repeat(100) });
      if (!res.ok) throw new Error(res.error);
      expect(String(res.params.prompt).length).toBeLessThan(r.prompt.length + 130);
    }
  });
});

describe("live presets show what they make", () => {
  const dir = path.join(process.cwd(), "public");

  it.each(RECIPES.map((r) => [r.id, r] as const))("%s has its preview clip and poster", (_id, r) => {
    expect(existsSync(path.join(dir, r.preview.video))).toBe(true);
    expect(existsSync(path.join(dir, r.preview.poster))).toBe(true);
  });
});
