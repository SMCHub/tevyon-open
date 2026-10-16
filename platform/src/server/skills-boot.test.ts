import { describe, expect, it } from "vitest";
import { z } from "zod";
import { catalog } from "../core/catalog";
import { defineSkills } from "../core/skills";
import { loadSkills, SKILLS_DIR } from "./skill-files";

// What the server does at boot (runtime.ts): the real skill files against the real catalog. Red here means the
// server would not start.
describe("prompt skills at boot", () => {
  const { skills } = loadSkills(SKILLS_DIR);
  const book = defineSkills(skills, catalog);

  it("gives every job type of the catalog its prompt skill", () => {
    for (const def of catalog.list()) expect(book.promptSkillFor(def.jobType, def.family).kind, def.jobType).toBe("prompt");
  });

  it("has a family skill for every model family of the catalog, so a new model of the family runs through it", () => {
    for (const def of catalog.list()) expect(book.familySkill(def.family!)?.name, def.jobType).toBe(`prompt-${def.family}`);
  });

  it("never lets a skill allow a longer prompt than the model's schema accepts", () => {
    const tooLong = catalog.list().flatMap((def) => {
      const max = book.promptSkillFor(def.jobType, def.family).rules?.maxChars;
      const schema = (z.toJSONSchema(def.params, { io: "input" }) as { properties?: Record<string, { maxLength?: number }> }).properties?.prompt?.maxLength;
      return max !== undefined && schema !== undefined && max > schema ? [`${def.jobType}: skill ${max}, schema ${schema}`] : [];
    });
    expect(tooLong).toEqual([]);
  });
});
