import type { Register } from "./register";
import type { Skill, SkillBook } from "./skills";

/**
 * Every generation runs through the prompt skill of its model (not only agents: the studio
 * uses the same skills). Two steps:
 * - check(): deterministic hints for the quote, no model call, no cost.
 * - compile(): the prompt that goes to the model. In "auto" mode a writer (language model) rewrites the user's idea
 *   with the skill as instructions; a failed, slow or unusable answer gets a second try, then guards and the timeout fall
 *   back to the tidied user prompt, so a job never fails here.
 * Only params.prompt is ever rewritten. Every other parameter (duration, start image …) passes through untouched.
 */
export type PromptMode = "auto" | "exact";

export type PromptNote = { code: PromptNoteCode; level: "info" | "warn"; message: string };
export type PromptNoteCode =
  | "too_long" | "too_short" | "aspect_conflict" | "text_unquoted" | "negation"
  | "camera_missing" | "audio_off" | "too_many_beats";

export type PromptCheck = { skill: string; notes: PromptNote[] };
export type PromptPlan = {
  skill: string;
  written: boolean;
  params: Record<string, unknown>;
  /** Why an "auto" prompt went out unwritten (writer error, timeout, guard), for the server log. Never in a job view. */
  fallback?: string;
  /** A skill rule the written prompt still breaks after the second try (it goes out anyway), for the server log. */
  slip?: "negation" | "format";
};

export type WriteRequest = {
  skill: Skill;
  kind: "image" | "video";
  /** Public model name, e.g. "Veo 3.1 Lite". */
  model: string;
  /** The user's prompt, tidied. */
  prompt: string;
  /** All other validated parameters (duration, aspect ratio, sound …), so the prompt fits them. */
  settings: Record<string, unknown>;
  /** On the second try: which skill rule the first answer broke, to fix it. */
  retry?: string;
};

/** Port for the language model that writes prompts. Server-side only; its vendor never reaches a job view. */
export interface PromptWriter {
  write(req: WriteRequest, signal?: AbortSignal): Promise<string>;
}

export type Prompting = {
  /** name@version of the prompt skill a job of this type runs through. */
  skillOf(jobType: string): string;
  check(jobType: string, params: Record<string, unknown>): PromptCheck;
  compile(jobType: string, params: Record<string, unknown>, mode: PromptMode): Promise<PromptPlan>;
};

/**
 * Word lists with Unicode-aware boundaries. JavaScript's \b only knows ASCII letters, so "\bÜberschrift"
 * never matched; these lookarounds treat umlauts as letters.
 */
const wordList = (list: string, flags = "iu") => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list})(?![\\p{L}\\p{N}])`, flags);

const QUOTED = /"([^"\n]+)"|“([^”\n]+)”|„([^“”\n]+)[“”]|«([^»\n]+)»/g;
const QUOTE_MARK = /["“”„«»]/;
const TEXT_WORDS = wordList("headline|title|caption|label|lettering|slogan|text|schriftzug|überschrift|schlagzeile|titel|aufschrift", "giu");
const NEGATION = wordList("no|without|kein|keine|keinen|keiner|ohne");
const CAMERA = wordList("camera|shot|close-?up|close up|wide|tracking|dolly|pan|panning|tilt|zoom|crane|drone|aerial|handheld|static|pov|orbit|push[- ]in|pull[- ]back|kamera|nahaufnahme|totale|kamerafahrt|schwenk|drohne|luftaufnahme|handkamera|statisch");
/** A speaking verb followed by a colon or a quote: "says: …", "sagt „…“". */
const SPEECH = new RegExp(`${wordList("says?|said|asks?|shouts?|whispers?|sings?|sagt|spricht|fragt|ruft|flüstert|singt").source}\\s*[:"“„«]`, "giu");
const SPEECH_WORDS = wordList("dialogue|dialog|voice-?over|stimme");
/** Text carriers: "a sign that says "OPEN"" is lettering, not speech. */
const SIGN = wordList("sign|label|poster|banner|board|billboard|screen|shirt|schild|plakat|aufschrift|tafel|bildschirm");
const BEATS = wordList("then|afterwards|after that|finally|dann|danach|anschliessend|anschließend|schliesslich|schließlich|zuletzt", "giu");
const VERTICAL = wordList("vertical|hochformat|hochkant|vertikal|portrait (?:format|orientation)|9:16");
const HORIZONTAL = wordList("horizontal|widescreen|querformat|breitbild|landscape (?:format|orientation)|16:9");
/** Aspect ratios a prompt may name («2.39:1», «16:9»); times like «10:30» are not among them. */
const RATIO = /(?<![\d.])(1:1|2:3|3:2|3:4|4:3|4:5|5:4|5:7|7:5|9:16|16:9|9:21|21:9|1:2|2:1|1\.85:1|2\.35:1|2\.39:1|2\.4:1)(?![\d.])/g;
/** References to the start image ("the person in the image") that a rewrite must keep. */
const IMAGE_REF = wordList("(?:in|from|of) the (?:start |input |reference )?(?:image|photo|picture)|(?:im|auf dem) (?:start)?(?:bild|foto)", "giu");

/** «@Bild1», «@image 2», «@img3»: how the studio names reference images; models read "image 1". */
const MENTION = /@(?:bild|image|img|ref)\s?(\d{1,2})\b/giu;
const NUMBERED_REF = /\bimage (\d{1,2})\b/giu;

/**
 * The @-mentions in the prompt without an attached image («@Bild3» with two references, or any mention on a model that
 * takes none), as «@BildN». A start frame counts as image 1 where the model has no reference list. Such a job would
 * reach the model without the image the prompt talks about, so it does not start.
 */
export function unattachedMentions(params: Record<string, unknown>): string[] {
  const refs = Array.isArray(params.references) ? params.references.length : typeof params.image === "string" ? 1 : 0;
  const named = new Set([...String(params.prompt ?? "").matchAll(MENTION)].map((m) => Number(m[1])));
  return [...named].filter((n) => n < 1 || n > refs).sort((a, b) => a - b).map((n) => `@Bild${n}`);
}
const numberedRefs = (text: string) => new Set([...text.matchAll(NUMBERED_REF)].map((m) => m[1]));

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Collapses runs of spaces, trims every line and keeps at most one empty line between paragraphs. */
export function tidy(text: string): string {
  return text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Shortens to the limit, after the last full sentence that fits, else after the last whole word. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  let end = -1;
  for (const m of head.matchAll(/[.!?](?=\s|$)/g)) if ((m.index ?? 0) < max) end = m.index ?? -1;
  if (end > 0) return head.slice(0, end + 1).trim();
  let cut = -1;
  for (const m of head.matchAll(/\s/g)) if ((m.index ?? 0) <= max) cut = m.index ?? -1;
  return (cut > 0 ? head.slice(0, cut) : text.slice(0, max)).trim();
}

function quotedSegments(text: string): string[] {
  return [...text.matchAll(QUOTED)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim()).filter(Boolean);
}

function orientation(aspect: unknown): "vertical" | "horizontal" | "square" | undefined {
  if (typeof aspect !== "string") return undefined;
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return undefined;
  return w > h ? "horizontal" : w < h ? "vertical" : "square";
}

function mentionsText(prompt: string): boolean {
  for (const m of prompt.matchAll(TEXT_WORDS)) {
    const before = prompt.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
    // «No on-screen text», «no other text»: guardrails at the end of a video prompt, not text to render.
    if (!/(no|without|kein\w*|ohne)\s+((on-screen|onscreen|other|burned-in|burnt-in|visible|weitere\w*|sonstige\w*)\s+)?$/i.test(before)) return true;
  }
  return false;
}

/** Spoken words in the prompt, not counting lettering on signs, labels or screens. */
function hasSpeech(prompt: string): boolean {
  if (SPEECH_WORDS.test(prompt)) return true;
  for (const m of prompt.matchAll(SPEECH)) {
    const clause = prompt.slice(0, m.index).split(/[.;!?\n]/).pop() ?? "";
    if (!SIGN.test(clause)) return true;
  }
  return false;
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`prompt writer took longer than ${ms} ms`));
    }, ms);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

export function createPrompting(deps: {
  register: Register;
  skills: SkillBook;
  writer?: PromptWriter;
  /** Upper bound per writer attempt (two attempts); afterwards the tidied user prompt is used. */
  timeoutMs?: number;
}): Prompting {
  // 5 s: the writer answers in about 2.5 s (measured 13.10.2026); beyond that the job goes ahead with the tidied prompt.
  const { register, skills, writer, timeoutMs = 5000 } = deps;

  function lookup(jobType: string) {
    const def = register.get(jobType);
    if (!def) throw new Error(`Unknown job type ${jobType}`);
    const skill = skills.promptSkillFor(jobType, def.family);
    if (!skill.rules) throw new Error(`${skill.name} has no prompt rules`);
    return { def, skill, rules: skill.rules, id: `${skill.name}@${skill.version}` };
  }

  function check(jobType: string, params: Record<string, unknown>): PromptCheck {
    const { def, rules, id } = lookup(jobType);
    const prompt = tidy(String(params.prompt ?? ""));
    const notes: PromptNote[] = [];
    const add = (code: PromptNoteCode, level: PromptNote["level"], message: string) => notes.push({ code, level, message });

    if (prompt.length > rules.maxChars) {
      add("too_long", "warn", `Zu lang für ${def.model}: ${prompt.length} von ${rules.maxChars} Zeichen. Der Prompt wird nach dem letzten ganzen Satz gekürzt.`);
    }
    if (words(prompt) < rules.minWords) {
      add("too_short", "info", "Kurzer Prompt: Der Prompt-Skill ergänzt Umgebung, Licht und Stil. Beschreibe sie selbst, wenn du sie festlegen willst.");
    }
    const want = orientation(params.aspect_ratio);
    const said = VERTICAL.test(prompt) ? "vertical" : HORIZONTAL.test(prompt) ? "horizontal" : undefined;
    if (want && said && want !== said) {
      add("aspect_conflict", "warn", `Der Prompt nennt ein anderes Format als die Einstellung ${String(params.aspect_ratio)}. Massgebend ist die Einstellung.`);
    }
    if (mentionsText(prompt) && !QUOTE_MARK.test(prompt)) {
      add("text_unquoted", "info", "Soll Text im Bild stehen? Setze ihn wörtlich in Anführungszeichen, dann bleibt er exakt so.");
    }
    if (rules.negations === "rephrase" && NEGATION.test(prompt)) {
      add("negation", "info", `${def.model} setzt Verneinungen schlecht um. Beschreibe, was zu sehen sein soll, z. B. «leere Strasse» statt «ohne Autos».`);
    }
    if (def.kind === "video") {
      if (!CAMERA.test(prompt)) {
        add("camera_missing", "info", "Keine Kamera angegeben. Der Prompt-Skill wählt eine passende Einstellung, z. B. Nahaufnahme oder langsame Kamerafahrt.");
      }
      if (params.generate_audio === false && hasSpeech(prompt)) {
        add("audio_off", "warn", "Der Ton ist aus: Gesprochenes im Prompt bleibt stumm. Schalte den Ton ein oder streiche den Dialog.");
      }
      const beats = [...prompt.matchAll(BEATS)].length;
      const duration = typeof params.duration === "number" ? params.duration : 5;
      const allowed = duration <= 5 ? 1 : duration <= 8 ? 2 : 3;
      if (beats > allowed) {
        add("too_many_beats", "warn", `Zu viele Handlungsschritte für ${duration} Sekunden. Plane höchstens ${allowed + 1} oder wähle eine längere Dauer.`);
      }
    }
    return { skill: id, notes };
  }

  /**
   * A skill rule the written prompt breaks, with what the writer is told on its second try: negations for a model that
   * cannot read them, or a format other than the setting (a ratio or an orientation).
   */
  function slipOf(text: string, rules: { negations: string }, aspect: unknown, model: string): { slip: "negation" | "format"; retry: string } | undefined {
    if (rules.negations === "rephrase" && NEGATION.test(text)) {
      return { slip: "negation", retry: `${model} cannot read negations: the answer used "no", "without" or similar. Describe only what is there instead (e.g. "clean unmarked walls" instead of "no text").` };
    }
    const want = orientation(aspect);
    if (want) {
      const ratios = [...text.matchAll(RATIO)].map((m) => m[1]);
      const said = VERTICAL.test(text) ? "vertical" : HORIZONTAL.test(text) ? "horizontal" : undefined;
      if (ratios.some((r) => r !== aspect) || (said && said !== want)) {
        return { slip: "format", retry: `The format is fixed at ${String(aspect)}: the answer named another aspect ratio or orientation. Name no other format.` };
      }
    }
    return undefined;
  }

  async function compile(jobType: string, params: Record<string, unknown>, mode: PromptMode): Promise<PromptPlan> {
    const { def, skill, rules, id } = lookup(jobType);
    const original = tidy(String(params.prompt ?? "")).replace(MENTION, (_m, n: string) => `image ${Number(n)}`);
    let prompt = fit(original, rules.maxChars);
    let written = false;

    let fallback: string | undefined;
    let slip: PromptPlan["slip"];

    // An empty prompt (image tools, a swap without a wish) has nothing to write: it goes out as it is.
    const auto = mode === "auto" && original !== "";
    if (auto && !writer) fallback = "no writer";
    if (auto && writer) {
      const { prompt: _ignored, ...rest } = params;
      // The writer learns that a start image exists, not where it is stored (data minimisation).
      const settings: Record<string, unknown> = rest.image === undefined ? { ...rest } : { ...rest, image: "start image provided" };
      // Likewise for reference images: how many, in which order, never their URLs.
      if (Array.isArray(rest.references)) {
        const n = rest.references.length;
        if (n === 0) delete settings.references;
        else settings.references = `${n} reference image${n === 1 ? "" : "s"} provided: ${n === 1 ? "image 1" : `image 1 to image ${n}`}`;
      }
      // Guards: inside the model's limit, every quoted text of the user still there word for word,
      // a reference to the start image ("the person in the image") and every numbered reference image still there.
      const rejects = (text: string): string | undefined => {
        if (text.length > rules.maxChars) return "guard: too long";
        if (!quotedSegments(original).every((q) => text.includes(q))) return "guard: quoted text";
        if (original.match(IMAGE_REF) && !text.match(IMAGE_REF)) return "guard: start image reference";
        const kept = numberedRefs(text);
        if (![...numberedRefs(original)].every((n) => kept.has(n))) return "guard: image references";
        return undefined;
      };
      // Every prompt goes through the skill: a failed, slow or unusable answer gets one more try before the job falls
      // back to the tidied user prompt.
      // A broken skill rule (negation, format) asks once more with the reason; a second slip still goes out written,
      // since the user's own words would break the same rule.
      let retry: string | undefined;
      let slipped: { text: string; slip: NonNullable<PromptPlan["slip"]> } | undefined;
      for (let attempt = 0; attempt < 2 && !written; attempt++) {
        const draft = await withTimeout(
          (signal) => writer.write({ skill, kind: def.kind, model: def.model, prompt: original, settings, ...(retry ? { retry } : {}) }, signal),
          timeoutMs,
        ).catch((e: unknown) => {
          fallback = e instanceof Error ? e.message : String(e);
          return undefined;
        });
        if (draft === undefined) continue;
        const text = tidy(draft);
        fallback = text ? rejects(text) : "empty answer";
        if (fallback) continue;
        const broken = slipOf(text, rules, params.aspect_ratio, def.model);
        if (broken && attempt === 0) {
          retry = broken.retry;
          slipped = { text, slip: broken.slip };
          continue;
        }
        prompt = text;
        written = true;
        slip = broken?.slip;
      }
      // The second try failed outright: the first answer, slip and all, still beats the user's raw words.
      if (!written && slipped) {
        prompt = slipped.text;
        written = true;
        slip = slipped.slip;
      }
    }
    return { skill: id, written, params: { ...params, prompt }, ...(fallback && !written ? { fallback } : {}), ...(slip ? { slip } : {}) };
  }

  return { skillOf: (jobType) => lookup(jobType).id, check, compile };
}
