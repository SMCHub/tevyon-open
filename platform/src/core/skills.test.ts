import { describe, expect, it } from "vitest";
import { defineRegister, jobType } from "./register";
import { defineSkills, parseSkill } from "./skills";

const VEO = `---
name: prompt-veo
version: 1.2.0
kind: prompt
models: [veo_3_1_lite, veo_3_1]
max_chars: 1800
min_words: 8
negations: rephrase
slots: [subject, action, setting, camera, light, style, audio]
description: >-
  Writes prompts for Veo 3.1.
  Trigger: any Veo job.
---

# Veo 3.1

Subject first.
`;

describe("parseSkill", () => {
  // A family skill can exist before the family's first model goes live (MiniMax, Seedance, Nano Banana): it names its
  // family instead of job types, and new models of that family run through it once they are activated.
  it("reads a family prompt skill that lists no job types yet", () => {
    const skill = parseSkill(VEO.replace("models: [veo_3_1_lite, veo_3_1]", "family: minimax").replace("name: prompt-veo", "name: prompt-minimax"));
    expect(skill).toMatchObject({ name: "prompt-minimax", kind: "prompt", models: [], family: "minimax" });
  });

  it("refuses a prompt skill with neither models nor a family", () => {
    expect(() => parseSkill(VEO.replace("models: [veo_3_1_lite, veo_3_1]\n", ""))).toThrow(/models or a family/);
  });

  it("reads the frontmatter and keeps the body as instructions", () => {
    const skill = parseSkill(VEO);
    expect(skill).toEqual({
      name: "prompt-veo",
      version: "1.2.0",
      kind: "prompt",
      models: ["veo_3_1_lite", "veo_3_1"],
      description: "Writes prompts for Veo 3.1. Trigger: any Veo job.",
      rules: { maxChars: 1800, minWords: 8, negations: "rephrase", slots: ["subject", "action", "setting", "camera", "light", "style", "audio"] },
      body: "# Veo 3.1\n\nSubject first.\n",
    });
  });

  it("gives workflow skills an empty model list", () => {
    const skill = parseSkill("---\nname: entwurf-final\nversion: 1.0.0\nkind: workflow\ndescription: Draft, then final.\n---\nSteps.\n");
    expect(skill.models).toEqual([]);
    expect(skill.kind).toBe("workflow");
    expect(skill.rules).toBeNull();
  });

  it("rejects a skill without a version, so every delivered skill can be pinned", () => {
    expect(() => parseSkill("---\nname: prompt-x\nkind: prompt\nmodels: [a]\nmax_chars: 900\nmin_words: 3\nslots: [subject]\ndescription: x\n---\nbody")).toThrow(/version/);
  });

  it("rejects a prompt skill that names no model", () => {
    expect(() => parseSkill("---\nname: prompt-x\nversion: 1.0.0\nkind: prompt\nmax_chars: 900\nmin_words: 3\nslots: [subject]\ndescription: x\n---\nbody")).toThrow(/models/);
  });

  it("rejects a prompt skill without a length limit, since the server enforces it on every job", () => {
    expect(() => parseSkill("---\nname: prompt-x\nversion: 1.0.0\nkind: prompt\nmodels: [a]\nmin_words: 3\nslots: [subject]\ndescription: x\n---\nbody")).toThrow(/max_chars/);
  });

  it("reads files saved with Windows line endings", () => {
    expect(parseSkill(VEO.replace(/\n/g, "\r\n")).name).toBe("prompt-veo");
  });

  it("rejects text without frontmatter", () => {
    expect(() => parseSkill("# Just markdown")).toThrow(/frontmatter/);
  });
});

describe("defineSkills", () => {
  const z = { parse: (x: unknown) => x } as never;
  const register = defineRegister([
    jobType({ jobType: "veo_3_1_lite", kind: "video", model: "Veo 3.1 Lite", tagline: "t", params: z, credits: () => 1, route: { provider: "p", providerModel: "m" } }),
    jobType({ jobType: "flux_2_pro", kind: "image", model: "FLUX.2 Pro", tagline: "t", params: z, credits: () => 1, route: { provider: "p", providerModel: "m" } }),
  ]);
  const skill = (name: string, models: string[], kind: "prompt" | "workflow" = "prompt") =>
    ({ name, version: "1.0.0", kind, models, description: "d", body: "b",
      rules: kind === "prompt" ? { maxChars: 1000, minWords: 3, negations: "ok" as const, slots: ["subject"] } : null });

  it("finds the prompt skill for each job type", () => {
    const book = defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"])], register);
    expect(book.promptSkillFor("flux_2_pro").name).toBe("prompt-flux");
  });

  it("refuses to start without a prompt skill for every job type", () => {
    expect(() => defineSkills([skill("prompt-veo", ["veo_3_1_lite"])], register)).toThrow(/flux_2_pro/);
  });

  it("refuses a prompt skill for a job type the register does not know", () => {
    expect(() =>
      defineSkills([skill("prompt-veo", ["veo_3_1_lite", "veo_9"]), skill("prompt-flux", ["flux_2_pro"])], register),
    ).toThrow(/veo_9/);
  });

  it("refuses two prompt skills for one job type", () => {
    expect(() =>
      defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"]), skill("prompt-veo-alt", ["veo_3_1_lite"])], register),
    ).toThrow(/veo_3_1_lite/);
  });

  // New models of a known family go live without a code change (automatic activation): they run through the
  // family's prompt skill, named prompt-<family>, unless a skill lists them by name.
  it("falls back to the family's prompt skill for a job type no skill lists", () => {
    const book = defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"])], register);
    expect(book.promptSkillFor("veo_4_fast", "veo").name).toBe("prompt-veo");
    expect(book.familySkill("veo")?.name).toBe("prompt-veo");
  });

  it("prefers the skill that lists a job type by name over the family fallback", () => {
    const book = defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"])], register);
    expect(book.promptSkillFor("flux_2_pro", "veo").name).toBe("prompt-flux");
  });

  it("has no skill for a family without its prompt skill file", () => {
    const book = defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"])], register);
    expect(book.familySkill("minimax")).toBeUndefined();
    expect(() => book.promptSkillFor("minimax_h3", "minimax")).toThrow(/minimax_h3/);
  });

  it("starts when a job type no skill lists has its family's prompt skill", () => {
    const withNewVeo = defineRegister([
      ...register.list(),
      jobType({ jobType: "veo_3_1_fast", kind: "video", model: "Veo 3.1 Fast", tagline: "t", family: "veo", params: z, credits: () => 1, route: { provider: "p", providerModel: "m2" } }),
    ]);
    const book = defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"])], withNewVeo);
    expect(book.promptSkillFor("veo_3_1_fast", "veo").name).toBe("prompt-veo");
  });

  it("still refuses to start when a job type has neither its own nor a family prompt skill", () => {
    const withMinimax = defineRegister([
      ...register.list(),
      jobType({ jobType: "minimax_h3", kind: "video", model: "MiniMax H3", tagline: "t", family: "minimax", params: z, credits: () => 1, route: { provider: "p", providerModel: "m3" } }),
    ]);
    expect(() => defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"])], withMinimax)).toThrow(/minimax_h3/);
  });

  it("finds a family skill by its family field, also when its name differs", () => {
    const book = defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"]), { ...skill("prompt-hailuo", []), family: "minimax" }], register);
    expect(book.familySkill("minimax")?.name).toBe("prompt-hailuo");
  });

  it("never treats a workflow skill as a family's prompt skill", () => {
    const book = defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"]), skill("prompt-kling", [], "workflow")], register);
    expect(book.familySkill("kling")).toBeUndefined();
  });

  it("lists workflow skills next to prompt skills", () => {
    const book = defineSkills([skill("prompt-veo", ["veo_3_1_lite"]), skill("prompt-flux", ["flux_2_pro"]), skill("entwurf-final", [], "workflow")], register);
    expect(book.list().map((s) => s.name)).toEqual(["entwurf-final", "prompt-flux", "prompt-veo"]);
    expect(book.get("entwurf-final")?.kind).toBe("workflow");
  });
});
