import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { catalog } from "../core/catalog";
import { defineSkills } from "../core/skills";
import { loadSkills, SKILLS_DIR } from "./skill-files";

describe("skills folder", () => {
  const bundle = loadSkills(SKILLS_DIR);

  it("gives every job type in the catalog exactly one prompt skill (no generation without one)", () => {
    expect(() => defineSkills(bundle.skills, catalog)).not.toThrow();
  });

  it("never names the supply route: no provider, no vendor model id in any skill file", () => {
    // Skills go to agents over the API and to a third-party model as system prompt (the supply route stays on the server).
    const routes = catalog.list().flatMap((d) => [d.route.provider, d.route.providerModel]);
    // Plus the hosts the research found behind the routes (13.10.2026): they are part of the supply route too.
    const forbidden = [...new Set([...routes, "openrouter", "fal.ai", "byok", "atlascloud", "atlas-cloud", "atlas cloud", "google-vertex"])].map((s) => s.toLowerCase());
    for (const file of bundle.allFiles) {
      const text = readFileSync(path.join(SKILLS_DIR, file), "utf8").toLowerCase();
      for (const word of forbidden) expect(text.includes(word), `${file} mentions ${word}`).toBe(false);
    }
  });

  // Skills are written by hand; the register is the truth. These keep the text from naming what is not offered
  // (review 15.10.2026: “Seedance 1.5 Pro”, “Nano Banana 2.1”, “Cheapest: Seedream 4.5” for 4:5).
  const texts = () =>
    bundle.allFiles
      .filter((f) => f.endsWith(".md"))
      // Sources name vendor documents (“Seedream 4.0–4.5 prompt guide”), not models on offer.
      .map((f) => ({ file: f, text: readFileSync(path.join(SKILLS_DIR, f), "utf8").split(/\n## Sources\b/)[0]! }));

  it("names only models the register offers (outside its sources)", () => {
    const names = catalog.list().map((d) => d.model);
    const TIER = /(?: (?:Pro|Fast|Mini|Lite|Max|Flex|Klein|Prime|Flash|Std|Flare|Sunburst|Image|Video))+$/;
    // A family is a model name up to its version (“Seedance” of “Seedance 2.0”), or without one, up to its tier
    // (“Nano Banana” of “Nano Banana Pro”).
    const families = [...new Set(names.map((n) => n.match(/^(.*?)[ .]?\d/)?.[1] ?? n.replace(TIER, "")))];
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mention = new RegExp(`\\b(?:${families.map(esc).join("|")})[ .]?\\d+(?:\\.\\d+)?(?![\\d,])(?:${TIER.source.slice(0, -1)})?`, "g");
    // A generation (“Veo 3”, “FLUX.2”) is fine where a model of it is on offer; a version nobody offers is not.
    const known = (n: string) => names.some((x) => x === n || (x.startsWith(n) && /^[ .\d]/.test(x.slice(n.length))));
    const unknown = texts().flatMap(({ file, text }) =>
      [...text.matchAll(mention)].map((m) => m[0]).filter((n) => !known(n)).map((n) => `${file}: ${n}`));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("names in a prompt skill's description only versions of its family that are on offer", () => {
    const book = defineSkills(bundle.skills, catalog);
    const names = catalog.list().map((d) => d.model);
    const known = (n: string) => names.some((x) => x === n || (x.startsWith(n) && /^[ .\d]/.test(x.slice(n.length))));
    const unknown = bundle.skills.filter((s) => s.kind === "prompt").flatMap((skill) => {
      // The families this skill serves, as model names spell them (“Seedance”, “GPT Image”).
      const served = catalog.list().filter((d) => book.promptSkillFor(d.jobType, d.family).name === skill.name).map((d) => d.model);
      const families = [...new Set(served.map((n) => n.match(/^(.*?)[ .]?\d/)?.[1]).filter((f): f is string => Boolean(f)))];
      // Bare versions in lists such as “2.0, 2.0 Fast, 2.5, 1.5 Pro”.
      const versions = [...skill.description.matchAll(/(?<![\d.])\d+\.\d+(?![\d.])(?: (?:Pro|Fast|Mini|Lite|Max|Flex|Klein|Prime|Flash|Flare))*/g)].map((m) => m[0]);
      return versions.filter((v) => !families.some((f) => [" ", ".", ""].some((sep) => known(`${f}${sep}${v}`)))).map((v) => `${skill.name}: ${v}`);
    });
    expect(unknown).toEqual([]);
  });

  it("names only job types the register has", () => {
    const prefixes = [...new Set(catalog.list().map((d) => `${d.jobType.split("_")[0]}_`))];
    const unknown = texts().flatMap(({ file, text }) =>
      [...text.matchAll(/`([a-z][a-z0-9_]*)`/g)]
        .map((m) => m[1]!)
        .filter((t) => prefixes.some((p) => t.startsWith(p)) && !catalog.get(t))
        .map((t) => `${file}: ${t}`));
    expect(unknown).toEqual([]);
  });

  it("serves only the files of a skill's own folder", () => {
    expect(bundle.read("prompt-veo", "SKILL.md")).toContain("name: prompt-veo");
    expect(bundle.read("prompt-veo", "../prompt-flux/SKILL.md")).toBeUndefined();
    expect(bundle.read("prompt-veo", "/etc/passwd")).toBeUndefined();
    expect(bundle.read("nope", "SKILL.md")).toBeUndefined();
  });

  it("keeps the shared rules out of the skill list and appends them on delivery", () => {
    expect(bundle.skills.map((s) => s.name)).not.toContain("_shared");
    expect(bundle.shared.length).toBeGreaterThan(0);
  });

  it("ignores hidden files such as .DS_Store", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "skills-"));
    mkdirSync(path.join(dir, "prompt-veo"));
    writeFileSync(path.join(dir, "prompt-veo", "SKILL.md"), readFileSync(path.join(SKILLS_DIR, "prompt-veo", "SKILL.md")));
    writeFileSync(path.join(dir, "prompt-veo", ".DS_Store"), "binary junk");
    writeFileSync(path.join(dir, ".DS_Store"), "binary junk");
    const local = loadSkills(dir);
    expect(local.files("prompt-veo")).toEqual(["SKILL.md"]);
    expect(local.allFiles).toEqual(["prompt-veo/SKILL.md"]);
  });
});
