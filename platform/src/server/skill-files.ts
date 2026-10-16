import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseSkill, type Skill } from "../core/skills";

/** Skills live as files in the repo (versioned, reviewed, tested) and are read once at boot. */
export const SKILLS_DIR = path.join(process.cwd(), "skills");

export type SkillBundle = {
  skills: Skill[];
  /** Files of one skill folder, relative to it (SKILL.md, references/…). */
  files(name: string): string[];
  /** A file of a skill folder, or undefined when the path is not one of that folder's files. */
  read(name: string, file: string): string | undefined;
  /** Rules appended to every delivered skill (folder _shared). */
  shared: string;
  /** Every file under the skills folder, relative to it. For checks over the whole tree. */
  allFiles: string[];
};

/** All files below dir, relative to base. Hidden entries (.DS_Store, .git …) are skipped. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).filter((entry) => !entry.startsWith(".")).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

export function loadSkills(dir: string): SkillBundle {
  const folders = readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(path.join(dir, f)).isDirectory());
  const filesByName = new Map<string, string[]>();
  const skills: Skill[] = [];

  for (const folder of folders.filter((f) => !f.startsWith("_"))) {
    const skill = parseSkill(readFileSync(path.join(dir, folder, "SKILL.md"), "utf8"));
    if (skill.name !== folder) throw new Error(`Skill folder ${folder} holds a skill named ${skill.name}`);
    skills.push(skill);
    filesByName.set(skill.name, walk(path.join(dir, folder)).sort());
  }

  const sharedDir = path.join(dir, "_shared");
  const shared = folders.includes("_shared")
    ? walk(sharedDir).sort().map((f) => readFileSync(path.join(sharedDir, f), "utf8").trim()).join("\n\n")
    : "";

  return {
    skills,
    files: (name) => filesByName.get(name) ?? [],
    read: (name, file) => {
      // Whitelist instead of path checks: only a file listed for this folder can be read.
      if (!(filesByName.get(name) ?? []).includes(file)) return undefined;
      return readFileSync(path.join(dir, name, file), "utf8");
    },
    shared,
    allFiles: walk(dir).sort(),
  };
}
