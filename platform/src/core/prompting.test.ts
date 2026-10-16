import { describe, expect, it } from "vitest";
import { createPrompting, type PromptWriter } from "./prompting";
import { defineRegister, jobType } from "./register";
import { defineSkills, type Skill } from "./skills";

const anySchema = { parse: (x: unknown) => x } as never;
const register = defineRegister([
  jobType({ jobType: "veo", kind: "video", model: "Veo", tagline: "t", params: anySchema, credits: () => 1, route: { provider: "p", providerModel: "m" } }),
  jobType({ jobType: "flux", kind: "image", model: "FLUX", tagline: "t", params: anySchema, credits: () => 1, route: { provider: "p", providerModel: "m" } }),
]);

function promptSkill(name: string, models: string[], rules: Partial<NonNullable<Skill["rules"]>> = {}): Skill {
  return {
    name, version: "1.0.0", kind: "prompt", models, description: "d", body: `# ${name}`,
    rules: { maxChars: 400, minWords: 4, negations: "ok", slots: ["subject", "action"], ...rules },
  };
}

function setup(opts: { writer?: PromptWriter; veo?: Partial<NonNullable<Skill["rules"]>>; flux?: Partial<NonNullable<Skill["rules"]>>; timeoutMs?: number } = {}) {
  const skills = defineSkills([promptSkill("prompt-veo", ["veo"], opts.veo), promptSkill("prompt-flux", ["flux"], opts.flux)], register);
  return createPrompting({ register, skills, writer: opts.writer, timeoutMs: opts.timeoutMs ?? 50 });
}

const codes = (r: { notes: { code: string }[] }) => r.notes.map((n) => n.code);

describe("check: hints before the job starts, without any model call", () => {
  it("names the prompt skill with its version", () => {
    expect(setup().check("veo", { prompt: "a red fox jumps over a frozen creek, tracking shot" }).skill).toBe("prompt-veo@1.0.0");
  });

  it("warns when the prompt is longer than the model takes", () => {
    const r = setup({ flux: { maxChars: 40 } }).check("flux", { prompt: "a quiet harbour at dawn with fishing boats and gulls over the water" });
    expect(r.notes).toContainEqual(expect.objectContaining({ code: "too_long", level: "warn" }));
  });

  it("asks for detail when the prompt is very short", () => {
    expect(codes(setup().check("flux", { prompt: "a fox" }))).toContain("too_short");
  });

  it("flags an orientation in the prompt that contradicts the chosen format", () => {
    expect(codes(setup().check("flux", { prompt: "vertical poster of a lighthouse in a storm", aspect_ratio: "16:9" }))).toContain("aspect_conflict");
    expect(codes(setup().check("flux", { prompt: "Hochformat: ein Leuchtturm im Sturm bei Nacht", aspect_ratio: "16:9" }))).toContain("aspect_conflict");
    expect(codes(setup().check("flux", { prompt: "a 16:9 shot of a lighthouse in a storm", aspect_ratio: "9:16" }))).toContain("aspect_conflict");
    expect(codes(setup().check("flux", { prompt: "vertical poster of a lighthouse in a storm", aspect_ratio: "9:16" }))).not.toContain("aspect_conflict");
  });

  it("asks for quotes when the prompt wants text rendered", () => {
    expect(codes(setup().check("flux", { prompt: "a poster with the headline Summer Sale in bold letters" }))).toContain("text_unquoted");
    expect(codes(setup().check("flux", { prompt: 'a poster with the headline "Summer Sale" in bold letters' }))).not.toContain("text_unquoted");
  });

  it("reads a guardrail like “No on-screen text” as no text wanted (FLUX 3 Video's own prompts end with it)", () => {
    expect(codes(setup().check("flux", { prompt: "a baker slides bread into the oven, warm light. No on-screen text, no subtitles." }))).not.toContain("text_unquoted");
    expect(codes(setup().check("flux", { prompt: "a quiet harbour at dawn, gulls overhead. No other text." }))).not.toContain("text_unquoted");
  });

  it("recognises German words that start with an umlaut", () => {
    // JavaScript's \b only knows ASCII letters: "\bÜberschrift" never matched before.
    expect(codes(setup().check("flux", { prompt: "ein Plakat mit der Überschrift Sommer Sale in grossen Buchstaben" }))).toContain("text_unquoted");
  });

  it("does not mistake a sign that says something for dialogue", () => {
    const sign = 'a neon sign that says "OPEN" flickers above a wet street, slow push-in';
    expect(codes(setup().check("veo", { prompt: sign, generate_audio: false }))).not.toContain("audio_off");
    const talk = 'a fisherman says: the storm is coming, handheld close-up';
    expect(codes(setup().check("veo", { prompt: talk, generate_audio: false }))).toContain("audio_off");
  });

  it("suggests positive wording only for models that handle negations badly", () => {
    const prompt = "a quiet street at night without cars, wet asphalt";
    expect(codes(setup({ flux: { negations: "rephrase" } }).check("flux", { prompt }))).toContain("negation");
    expect(codes(setup({ flux: { negations: "ok" } }).check("flux", { prompt }))).not.toContain("negation");
  });

  it("asks videos for a camera move and leaves images alone", () => {
    const prompt = "a red fox runs through deep snow in a pine forest";
    expect(codes(setup().check("veo", { prompt }))).toContain("camera_missing");
    expect(codes(setup().check("veo", { prompt: `${prompt}, slow tracking shot` }))).not.toContain("camera_missing");
    expect(codes(setup().check("flux", { prompt }))).not.toContain("camera_missing");
  });

  it("warns when a video has dialogue but sound is switched off", () => {
    const prompt = 'close-up of an old fisherman who says "the storm is coming", handheld camera';
    expect(codes(setup().check("veo", { prompt, generate_audio: false }))).toContain("audio_off");
    expect(codes(setup().check("veo", { prompt, generate_audio: true }))).not.toContain("audio_off");
  });

  it("warns when a short clip has to fit too many actions", () => {
    const prompt = "a woman opens the door, then walks to the window, then sits down, then starts to cry, static camera";
    expect(codes(setup().check("veo", { prompt, duration: 4 }))).toContain("too_many_beats");
    expect(codes(setup().check("veo", { prompt: "a woman opens the door and looks outside, static camera", duration: 4 }))).not.toContain("too_many_beats");
  });
});

describe("compile: the prompt that goes to the model", () => {
  it("tidies whitespace and passes every other parameter through untouched", async () => {
    const plan = await setup().compile("veo", { prompt: "  a   red fox  \n\n\n jumps   over ice ", duration: 8, image: "/api/media/uploads/u1/a.png" }, "exact");
    expect(plan).toEqual({
      skill: "prompt-veo@1.0.0",
      written: false,
      params: { prompt: "a red fox\n\njumps over ice", duration: 8, image: "/api/media/uploads/u1/a.png" },
    });
  });

  it("cuts an over-long prompt after the last full sentence that fits", async () => {
    const plan = await setup({ flux: { maxChars: 30 } }).compile("flux", { prompt: "One cat sits. Two dogs run. Three birds fly far away." }, "exact");
    expect(plan.params.prompt).toBe("One cat sits. Two dogs run.");
  });

  it("cuts at a line break when that keeps more of the prompt than the last space", async () => {
    const plan = await setup({ flux: { maxChars: 14 } }).compile("flux", { prompt: "red fox jumps\nover the frozen creek" }, "exact");
    expect(plan.params.prompt).toBe("red fox jumps");
  });

  it("lets the writer turn the user's idea into the model's prompt", async () => {
    const writer: PromptWriter = { write: async () => "Wide shot: a red fox leaps over a frozen creek at dawn, slow tracking camera." };
    const plan = await setup({ writer }).compile("veo", { prompt: "fuchs springt über eis", duration: 8 }, "auto");
    expect(plan).toEqual({
      skill: "prompt-veo@1.0.0",
      written: true,
      params: { prompt: "Wide shot: a red fox leaps over a frozen creek at dawn, slow tracking camera.", duration: 8 },
    });
  });

  it("hands the writer the skill, the model kind and the settings", async () => {
    let seen: Parameters<PromptWriter["write"]>[0] | undefined;
    const writer: PromptWriter = { write: async (req) => { seen = req; return "a red fox leaps over a frozen creek"; } };
    await setup({ writer }).compile("veo", { prompt: "fuchs springt", duration: 8 }, "auto");
    expect(seen).toMatchObject({ skill: { name: "prompt-veo" }, kind: "video", model: "Veo", prompt: "fuchs springt", settings: { duration: 8 } });
  });

  it("does not call the writer when the caller already applied the skill", async () => {
    let calls = 0;
    const writer: PromptWriter = { write: async () => { calls++; return "x"; } };
    await setup({ writer }).compile("veo", { prompt: "a red fox leaps over a frozen creek, tracking shot" }, "exact");
    expect(calls).toBe(0);
  });

  it("keeps text the user quoted word for word, or falls back to the user's prompt", async () => {
    const writer: PromptWriter = { write: async () => 'A summer poster with the headline "SUMMER SALE".' };
    const plan = await setup({ writer }).compile("flux", { prompt: 'Sommerplakat mit der Schlagzeile "Sommer-Sale 2026"' }, "auto");
    expect(plan).toMatchObject({ written: false, params: { prompt: 'Sommerplakat mit der Schlagzeile "Sommer-Sale 2026"' } });
  });

  it("accepts quoted text in other quote marks as long as the words are exact", async () => {
    const writer: PromptWriter = { write: async () => "A summer poster, bold headline “Sommer-Sale 2026” at the top." };
    const plan = await setup({ writer }).compile("flux", { prompt: "Sommerplakat mit der Schlagzeile «Sommer-Sale 2026»" }, "auto");
    expect(plan.written).toBe(true);
  });

  it("falls back to the user's prompt when the writer runs over the model's limit", async () => {
    const writer: PromptWriter = { write: async () => "word ".repeat(200) };
    const plan = await setup({ writer, flux: { maxChars: 100 } }).compile("flux", { prompt: "a lighthouse in a storm at night" }, "auto");
    expect(plan).toMatchObject({ written: false, params: { prompt: "a lighthouse in a storm at night" } });
  });

  it("keeps the reference to the start image, or falls back to the prompt as written", async () => {
    // Presets start with "The person in the image …": the writer must not turn that into a new person.
    const writer: PromptWriter = { write: async () => "A smiling woman turns toward the camera, warm daylight." };
    const plan = await setup({ writer }).compile("veo", { prompt: "The person in the image turns to the camera and smiles", image: "/api/media/uploads/u1/a.png" }, "auto");
    expect(plan).toMatchObject({ written: false, params: { prompt: "The person in the image turns to the camera and smiles" } });
  });

  it("tells the writer that a start image exists without handing over where it is stored", async () => {
    let seen: Parameters<PromptWriter["write"]>[0] | undefined;
    const writer: PromptWriter = { write: async (req) => { seen = req; return "The person in the image turns to the camera."; } };
    await setup({ writer }).compile("veo", { prompt: "The person in the image turns", image: "/api/media/uploads/u1/a.png", duration: 8 }, "auto");
    expect(seen?.settings).toEqual({ image: "start image provided", duration: 8 });
  });

  it("turns @-mentions of reference images into the words image models understand", async () => {
    const refs = ["/api/media/uploads/u1/a.png", "/api/media/uploads/u1/b.png"];
    const plan = await setup().compile("flux", { prompt: "Die Katze aus @Bild1 sitzt im Zimmer von @image2, Stil wie @img1", references: refs }, "exact");
    expect(plan.params).toEqual({ prompt: "Die Katze aus image 1 sitzt im Zimmer von image 2, Stil wie image 1", references: refs });
  });

  it("tells the writer how many reference images there are, never where they are stored, and keeps every numbered one", async () => {
    let seen: Parameters<PromptWriter["write"]>[0] | undefined;
    const keeps: PromptWriter = { write: async (req) => { seen = req; return "The cat from image 1 sits by the window of the room in image 2, soft light."; } };
    const refs = ["/api/media/uploads/u1/a.png", "/api/media/uploads/u1/b.png"];
    const ok = await setup({ writer: keeps }).compile("flux", { prompt: "the cat from @Bild1 in the room of @Bild2", references: refs }, "auto");
    expect(seen?.settings).toEqual({ references: "2 reference images provided: image 1 to image 2" });
    expect(ok).toMatchObject({ written: true, params: { references: refs } });

    const drops: PromptWriter = { write: async () => "A cat sits by a sunny window, soft light." };
    const plan = await setup({ writer: drops }).compile("flux", { prompt: "the cat from @Bild1 in the room of @Bild2", references: refs }, "auto");
    expect(plan).toMatchObject({ written: false, params: { prompt: "the cat from image 1 in the room of image 2" } });
  });

  it("asks the writer a second time when the first answer fails, hangs or drops something", async () => {
    const answers: (() => Promise<string>)[] = [
      async () => { throw new Error("upstream 500"); },
      () => new Promise<string>(() => {}),
      async () => "A cat sits by a sunny window.", // drops image 1
    ];
    for (const first of answers) {
      let calls = 0;
      const writer: PromptWriter = { write: () => (++calls === 1 ? first() : Promise.resolve("The cat from image 1 sits by a sunny window, soft light.")) };
      const plan = await setup({ writer, timeoutMs: 20 }).compile("flux", { prompt: "die Katze aus @Bild1 am Fenster", references: ["/api/media/uploads/u1/a.png"] }, "auto");
      expect(plan).toMatchObject({ written: true, params: { prompt: "The cat from image 1 sits by a sunny window, soft light." } });
      expect(calls).toBe(2);
    }
  });

  it("names why a prompt went out unwritten, so the server can log it", async () => {
    const failing: PromptWriter = { write: async () => { throw new Error("prompt writer 402"); } };
    const plan = await setup({ writer: failing, timeoutMs: 20 }).compile("flux", { prompt: "a lighthouse" }, "auto");
    expect(plan).toMatchObject({ written: false, fallback: "prompt writer 402" });
    const guard: PromptWriter = { write: async () => "A cat sits by a window." };
    const dropped = await setup({ writer: guard }).compile("flux", { prompt: "the cat from @Bild1", references: ["/api/media/uploads/u1/a.png"] }, "auto");
    expect(dropped).toMatchObject({ written: false, fallback: "guard: image references" });
    expect(await setup().compile("flux", { prompt: "a lighthouse" }, "auto")).toMatchObject({ written: false, fallback: "no writer" });
    expect(await setup({ writer: failing }).compile("flux", { prompt: "a lighthouse" }, "exact")).not.toHaveProperty("fallback");
  });

  it("does not call the writer for an empty prompt (image tools, a swap without a wish): there is nothing to write", async () => {
    let calls = 0;
    const writer: PromptWriter = { write: async () => { calls++; return "something"; } };
    const plan = await setup({ writer }).compile("flux", { prompt: "", image: "/api/media/uploads/u1/a.png" }, "auto");
    expect(plan).toMatchObject({ written: false, params: { prompt: "" } });
    expect(plan).not.toHaveProperty("fallback");
    expect(calls).toBe(0);
  });

  it("never lets a failing or slow writer block the job", async () => {
    const failing: PromptWriter = { write: async () => { throw new Error("upstream 500"); } };
    const hanging: PromptWriter = { write: () => new Promise<string>(() => {}) };
    for (const writer of [failing, hanging]) {
      const plan = await setup({ writer, timeoutMs: 20 }).compile("flux", { prompt: "a lighthouse in a storm at night" }, "auto");
      expect(plan).toMatchObject({ written: false, params: { prompt: "a lighthouse in a storm at night" } });
    }
  });
});

describe("compile: the written prompt keeps the skill's rules", () => {
  const ask = (answers: string[]) => {
    const requests: { retry?: string }[] = [];
    const writer: PromptWriter = { write: async (req) => { requests.push(req); return answers[Math.min(requests.length, answers.length) - 1]!; } };
    return { writer, requests };
  };

  it("asks again, with the reason, when the answer uses negations a model like FLUX cannot read", async () => {
    const { writer, requests } = ask([
      "A detective in a foggy alley at night, warm gas lamps. No text, no logos, no watermark.",
      "A detective in a foggy alley at night, warm gas lamps, clean unmarked walls.",
    ]);
    const plan = await setup({ writer, flux: { negations: "rephrase" } }).compile("flux", { prompt: "Detektiv in einer nebligen Gasse, ohne Text", aspect_ratio: "16:9" }, "auto");
    expect(plan).toMatchObject({ written: true, params: { prompt: "A detective in a foggy alley at night, warm gas lamps, clean unmarked walls." } });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.retry).toMatch(/negation/i);
  });

  it("leaves negations alone where the skill allows them", async () => {
    const { writer, requests } = ask(["A detective in a foggy alley at night. No text, no logos."]);
    const plan = await setup({ writer, flux: { negations: "ok" } }).compile("flux", { prompt: "Detektiv in einer Gasse", aspect_ratio: "16:9" }, "auto");
    expect(plan).toMatchObject({ written: true });
    expect(requests).toHaveLength(1);
  });

  it("asks again when the answer names a format other than the setting", async () => {
    for (const wrong of ["anamorphic widescreen 2.39:1 composition", "vertical 9:16 framing", "a portrait orientation shot"]) {
      const { writer, requests } = ask([`A detective in a foggy alley, ${wrong}.`, "A detective in a foggy alley, low-angle medium-wide shot."]);
      const plan = await setup({ writer }).compile("flux", { prompt: "Detektiv in einer Gasse", aspect_ratio: "16:9" }, "auto");
      expect(plan).toMatchObject({ written: true, params: { prompt: "A detective in a foggy alley, low-angle medium-wide shot." } });
      expect(requests[1]!.retry).toMatch(/16:9/);
    }
    const { writer, requests } = ask(["A detective in a foggy alley, cinematic widescreen 16:9 composition."]);
    await setup({ writer }).compile("flux", { prompt: "Detektiv in einer Gasse", aspect_ratio: "16:9" }, "auto");
    expect(requests).toHaveLength(1);
  });

  it("keeps the first written answer when the second try fails outright", async () => {
    let calls = 0;
    const writer: PromptWriter = { write: async () => { if (++calls === 1) return "A foggy alley at night, no people."; throw new Error("upstream 500"); } };
    const plan = await setup({ writer, flux: { negations: "rephrase" } }).compile("flux", { prompt: "eine neblige Gasse ohne Menschen" }, "auto");
    expect(plan).toMatchObject({ written: true, params: { prompt: "A foggy alley at night, no people." }, slip: "negation" });
  });

  it("still sends the written prompt when the second answer keeps such a slip, and names it for the log", async () => {
    const { writer } = ask(["A foggy alley, no people.", "A foggy alley, no people at all."]);
    const plan = await setup({ writer, flux: { negations: "rephrase" } }).compile("flux", { prompt: "eine neblige Gasse ohne Menschen" }, "auto");
    expect(plan).toMatchObject({ written: true, params: { prompt: "A foggy alley, no people at all." }, slip: "negation" });
  });
});
