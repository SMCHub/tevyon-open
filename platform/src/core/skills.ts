/**
 * Skills: versioned SKILL.md files for agents and for the prompt writer.
 * Two kinds:
 * - prompt: how to write a prompt for one model family. Every job type has exactly one (no generation without it).
 * - workflow: a multi-step recipe over the job API (draft → final, format sets …).
 * The frontmatter is a deliberate YAML subset: scalars, flat [a, b] lists and folded `>-` text.
 */
export type SkillKind = "prompt" | "workflow";

/**
 * Machine rules of a prompt skill, read from its frontmatter so agents and the server see the same numbers.
 * The server checks every prompt against them (notes in the quote) and the writer must stay inside them.
 */
export type PromptRules = {
  /** Hard cap for the prompt sent to the model, in characters. */
  maxChars: number;
  /** Below this many words the prompt lacks detail; the writer fills the slots. */
  minWords: number;
  /** "rephrase": the model handles negations ("no text") badly, say what should be there instead. */
  negations: "ok" | "rephrase";
  /** Ordered building blocks of a good prompt for this model. */
  slots: string[];
};

export type Skill = {
  name: string;
  version: string;
  kind: SkillKind;
  /** Job types this prompt skill serves. Empty for workflow skills. */
  models: string[];
  /** Prompt skills: the model family it serves (prompt-<family> by name, or this field). New models of the family run
   * through it without being listed, so a family skill can exist before the family's first model goes live. */
  family?: string;
  description: string;
  /** Prompt skills only. */
  rules: PromptRules | null;
  /** The markdown after the frontmatter: the instructions an agent or the prompt writer reads. */
  body: string;
};

export function parseSkill(source: string): Skill {
  const markdown = source.replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown);
  if (!match) throw new Error("SKILL.md needs a frontmatter block between --- lines");
  const [, head = "", body = ""] = match;
  const fields = parseFrontmatter(head);

  const name = fields.get("name");
  const version = fields.get("version");
  const kind = fields.get("kind");
  const description = fields.get("description");
  if (typeof name !== "string" || !name) throw new Error("SKILL.md frontmatter needs a name");
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${name}: frontmatter needs a version like 1.0.0`);
  if (kind !== "prompt" && kind !== "workflow") throw new Error(`${name}: kind must be prompt or workflow`);
  if (typeof description !== "string" || !description) throw new Error(`${name}: frontmatter needs a description`);

  const raw = fields.get("models");
  const models = Array.isArray(raw) ? raw : [];
  const family = fields.get("family");
  if (family !== undefined && (typeof family !== "string" || !/^[a-z0-9-]+$/.test(family))) throw new Error(`${name}: family must be a lowercase word like minimax`);
  if (kind === "prompt" && models.length === 0 && !family) throw new Error(`${name}: a prompt skill needs models or a family`);

  return {
    name, version, kind, models, ...(typeof family === "string" ? { family } : {}), description,
    rules: kind === "prompt" ? readRules(name, fields) : null, body: body.replace(/^\n+/, ""),
  };
}

function readRules(name: string, fields: Map<string, string | string[]>): PromptRules {
  const num = (key: string) => {
    const v = fields.get(key);
    const n = typeof v === "string" ? Number(v) : NaN;
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name}: prompt skill needs ${key} as a positive whole number`);
    return n;
  };
  const slots = fields.get("slots");
  if (!Array.isArray(slots) || slots.length === 0) throw new Error(`${name}: prompt skill needs slots: [subject, …]`);
  const negations = fields.get("negations") ?? "ok";
  if (negations !== "ok" && negations !== "rephrase") throw new Error(`${name}: negations must be ok or rephrase`);
  return { maxChars: num("max_chars"), minWords: num("min_words"), negations, slots };
}

function parseFrontmatter(head: string): Map<string, string | string[]> {
  const fields = new Map<string, string | string[]>();
  const lines = head.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key = "", value = ""] = m;
    if (value === ">-" || value === ">") {
      // Folded block: following indented lines joined with single spaces.
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? "")) parts.push((lines[++i] ?? "").trim());
      fields.set(key, parts.join(" "));
    } else if (value.startsWith("[") && value.endsWith("]")) {
      fields.set(key, value.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean));
    } else {
      fields.set(key, value.replace(/^["']|["']$/g, ""));
    }
  }
  return fields;
}

export type SkillBook = {
  list(): Skill[];
  get(name: string): Skill | undefined;
  /**
   * The prompt skill every job of this type runs through: the skill that lists it by name, else its family's skill
   * (prompt-<family>), so a new model of a known family runs without a code change. Throws when there is neither.
   */
  promptSkillFor(jobType: string, family?: string): Skill;
  /** The prompt skill of a model family (prompt-<family>), if its file exists. Gate for activating new models. */
  familySkill(family: string): Skill | undefined;
};

/**
 * Builds the skill book and enforces the rule “no generation without a prompt skill”:
 * every job type in the register has exactly one prompt skill, and no prompt skill names an unknown job type.
 * Throws at boot, so a model added to the catalog without a skill cannot go live.
 */
export function defineSkills(skills: Skill[], register: { list(): { jobType: string; family?: string }[] }): SkillBook {
  const byName = new Map<string, Skill>();
  for (const s of skills) {
    if (byName.has(s.name)) throw new Error(`Skill ${s.name} exists twice`);
    byName.set(s.name, s);
  }

  const known = new Set(register.list().map((d) => d.jobType));
  const byJobType = new Map<string, Skill>();
  for (const s of skills) {
    if (s.kind !== "prompt") continue;
    for (const jobType of s.models) {
      if (!known.has(jobType)) throw new Error(`Prompt skill ${s.name} names unknown job type ${jobType}`);
      const other = byJobType.get(jobType);
      if (other) throw new Error(`Job type ${jobType} has two prompt skills: ${other.name} and ${s.name}`);
      byJobType.set(jobType, s);
    }
  }
  const familySkill = (family: string) => {
    const s = byName.get(`prompt-${family}`) ?? skills.find((x) => x.kind === "prompt" && x.family === family);
    return s?.kind === "prompt" ? s : undefined;
  };
  // Covered: listed by a skill, or the job type's family has its prompt skill (prompt-<family>).
  const familyOf = new Map(register.list().map((d) => [d.jobType, d.family]));
  const uncovered = [...known].filter((t) => !byJobType.has(t) && !(familyOf.get(t) && familySkill(familyOf.get(t)!)));
  if (uncovered.length) throw new Error(`No prompt skill for job type ${uncovered.join(", ")}: every model needs one before it can generate`);

  return {
    list: () => [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    get: (name) => byName.get(name),
    promptSkillFor: (jobType, family) => {
      const s = byJobType.get(jobType) ?? (family ? familySkill(family) : undefined);
      if (!s) throw new Error(`No prompt skill for job type ${jobType}`);
      return s;
    },
    familySkill,
  };
}
