import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { buildRecipeJob, LISTED_RECIPES, RECIPES, publicRecipe, resolveRecipeModel } from "./recipes";

const PHOTO = "/api/media/uploads/00000000-0000-4000-8000-000000000001/a1b2.jpg";

describe("recipes (presets)", () => {
  it("turns one click plus a photo and a line into a complete, valid job", () => {
    const res = buildRecipeJob("say-it", { image: PHOTO, wish: "Hello there" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const def = catalog.get(res.jobType)!;
    expect(def.params.safeParse(res.params).success).toBe(true);
    expect(res.params).toMatchObject({ image: PHOTO, aspect_ratio: "9:16" });
  });

  it("asks for the photo when a preset needs one", () => {
    expect(buildRecipeJob("say-it", { wish: "Hello" })).toEqual({ ok: false, error: "image_required" });
  });

  it("rejects an unknown preset", () => {
    expect(buildRecipeJob("nope", { image: PHOTO })).toEqual({ ok: false, error: "unknown_recipe" });
  });

  it("builds a valid job for every preset", () => {
    for (const r of RECIPES) {
      const res = buildRecipeJob(r.id, { image: PHOTO, wish: r.line ? "Hello everyone" : undefined });
      if (!res.ok) throw new Error(`${r.id}: ${res.error}`);
      expect(catalog.get(res.jobType)?.params.safeParse(res.params).success, r.id).toBe(true);
    }
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    expect(LISTED_RECIPES.map((r) => r.id)).toEqual(expect.arrayContaining(["say-it", "voiceover-ad"]));
  });

  it("never hands the recipe prompt or the model route to the browser", () => {
    for (const r of RECIPES) {
      const text = JSON.stringify(publicRecipe(r));
      expect(text).not.toContain(r.prompt.slice(0, 30));
      expect(text).not.toContain(r.jobType);
    }
  });
});

describe("preset model", () => {
  it("runs on its job type while the register has it, and nowhere otherwise", () => {
    expect(resolveRecipeModel("veo_3_1_lite", catalog)).toEqual({ ok: true, jobType: "veo_3_1_lite" });
    expect(resolveRecipeModel("gone_model", catalog)).toEqual({ ok: false, reason: "unknown" });
  });
});
