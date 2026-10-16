import { describe, expect, it } from "vitest";
import { catalog } from "../core/catalog";
import { DRAFT_RECIPES, LISTED_RECIPES, RECIPES } from "../core/recipes";
import type { Register } from "../core/register";
import { presetsForMcp } from "./mcp-presets";

const PHOTO = "/api/media/uploads/00000000-0000-4000-8000-000000000001/me.png";
const quote = () => 45;
/** A register without the presets' model. */
const empty: Pick<Register, "get"> = { get: () => undefined };

describe("presets for the MCP server", () => {
  it("lists every preset with the price of one run and none of the recipe prompts", () => {
    const presets = presetsForMcp({ register: catalog, quote });
    const list = presets.list();
    expect(list.map((p) => p.id)).toEqual(LISTED_RECIPES.map((r) => r.id));
    expect(list[0]).toEqual({
      id: RECIPES[0]!.id, title: RECIPES[0]!.title, tagline: RECIPES[0]!.tagline, category: RECIPES[0]!.category,
      needs: RECIPES[0]!.needs, badge: RECIPES[0]!.badge ?? null, wishHint: RECIPES[0]!.wishHint ?? null, line: RECIPES[0]!.line ?? null,
      credits: 45,
    });
    const json = JSON.stringify(list);
    for (const r of RECIPES) expect(json).not.toContain(r.prompt.slice(0, 40));
  });

  it("leaves out presets whose model is not in the register", () => {
    expect(presetsForMcp({ register: empty, quote }).list()).toEqual([]);
  });

  it("builds the run of a preset with the photo, the wish and its marker, like POST /api/presets/{id}", () => {
    const r = DRAFT_RECIPES.find((p) => !p.line)!;
    const presets = presetsForMcp({ register: catalog, quote, recipes: DRAFT_RECIPES });
    // build() finds live presets only; a draft is not startable.
    expect(presets.build(r.id, { image: PHOTO })).toEqual({ ok: false, error: "unknown_recipe" });
    const live = RECIPES[0]!;
    const run = presetsForMcp({ register: catalog, quote }).build(live.id, { image: PHOTO, wish: "Hello there" });
    expect(run).toEqual({
      ok: true, jobType: live.jobType,
      params: { ...live.params, prompt: live.prompt.replace("{line}", "Hello there."), image: PHOTO },
      recipe: { id: live.id, title: live.title, wish: "Hello there" },
    });
  });

  it("says why a preset cannot run", () => {
    const r = RECIPES[0]!;
    const ok = presetsForMcp({ register: catalog, quote });
    expect(ok.build("nope", { image: PHOTO })).toEqual({ ok: false, error: "unknown_recipe" });
    expect(ok.build(r.id, { image: PHOTO })).toEqual({ ok: false, error: "line_required" });
    expect(presetsForMcp({ register: empty, quote }).build(r.id, { image: PHOTO, wish: "Hi" })).toEqual({ ok: false, error: "unknown_job_type" });
  });

  it("prices presets that speak a line, so their price guarantee holds", () => {
    const all = [...RECIPES, ...DRAFT_RECIPES];
    const withLine = all.filter((r) => r.line);
    expect(withLine.length).toBeGreaterThan(0);
    const presets = presetsForMcp({ register: catalog, quote, recipes: all });
    for (const r of withLine) expect(presets.list().find((p) => p.id === r.id)?.credits, r.id).toBe(45);
  });
});
