import { describe, expect, it } from "vitest";
import type { Skill } from "../core/skills";
import { createChatPromptWriter } from "./prompt-writer";

const skill: Skill = {
  name: "prompt-veo", version: "1.0.0", kind: "prompt", models: ["veo_3_1_lite"], description: "d",
  body: "# Veo\n\nLead with the subject, then the action.", rules: { maxChars: 1800, minWords: 8, negations: "rephrase", slots: ["subject", "action", "camera"] },
};
const request = { skill, kind: "video" as const, model: "Veo 3.1 Lite", prompt: "fuchs springt über eis", settings: { duration: 8, generate_audio: true } };

function fakeFetch(answer: { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const reply = (content: string) => ({ choices: [{ message: { content } }] });

describe("prompt writer", () => {
  it("returns the prompt the language model wrote", async () => {
    const { f } = fakeFetch({ body: reply(JSON.stringify({ prompt: "A red fox leaps over a frozen creek, tracking shot." })) });
    const writer = createChatPromptWriter({ apiKey: "k", fetch: f });
    expect(await writer.write(request)).toBe("A red fox leaps over a frozen creek, tracking shot.");
  });

  it("gives the model the skill as instructions, the limits and the fixed settings, and the user's words as the task", async () => {
    const { f, calls } = fakeFetch({ body: reply(JSON.stringify({ prompt: "x" })) });
    await createChatPromptWriter({ apiKey: "k", fetch: f, model: "writer/model-1" }).write(request);
    const body = JSON.parse(String(calls[0]?.init.body));
    const system = body.messages[0].content as string;
    expect(body.model).toBe("writer/model-1");
    expect(system).toContain("Lead with the subject, then the action.");
    expect(system).toContain("1800");
    expect(system).toContain("subject → action → camera");
    expect(system).toContain('"duration":8');
    expect(body.messages[1]).toEqual({ role: "user", content: "fuchs springt über eis" });
  });

  it("states the skill's negation rule and the fixed format as hard rules, and on a second try why the first failed", async () => {
    const system = async (req: Parameters<ReturnType<typeof createChatPromptWriter>["write"]>[0]) => {
      const { f, calls } = fakeFetch({ body: reply(JSON.stringify({ prompt: "x" })) });
      await createChatPromptWriter({ apiKey: "k", fetch: f }).write(req);
      return JSON.parse(String(calls[0]?.init.body)).messages[0].content as string;
    };
    const first = await system({ ...request, settings: { ...request.settings, aspect_ratio: "16:9" } });
    expect(first).toMatch(/never write negations/i);
    expect(first).toMatch(/no aspect ratio or orientation other than 16:9/i);
    expect(first).not.toMatch(/previous answer/i);
    const allowed = await system({ ...request, skill: { ...skill, rules: { ...skill.rules!, negations: "ok" } } });
    expect(allowed).not.toMatch(/never write negations/i);
    const again = await system({ ...request, retry: "FLUX cannot read negations." });
    expect(again).toContain("Your previous answer broke a rule: FLUX cannot read negations.");
  });

  it("asks that neither the vendor nor anyone else keeps the data for training", async () => {
    // Privacy policy: «kein Training mit deinen Inhalten» also holds for this call.
    const { f, calls } = fakeFetch({ body: reply(JSON.stringify({ prompt: "x" })) });
    await createChatPromptWriter({ apiKey: "k", fetch: f }).write(request);
    expect(JSON.parse(String(calls[0]?.init.body)).provider).toMatchObject({ data_collection: "deny" });
  });

  it("asks for a direct answer without a thinking step (2.5 s instead of 4.5 s, measured 13.10.2026)", async () => {
    const { f, calls } = fakeFetch({ body: reply(JSON.stringify({ prompt: "x" })) });
    await createChatPromptWriter({ apiKey: "k", fetch: f }).write(request);
    expect(JSON.parse(String(calls[0]?.init.body)).reasoning).toEqual({ effort: "none" });
  });

  it("accepts a plain-text answer when the model ignores the JSON format", async () => {
    const { f } = fakeFetch({ body: reply("A red fox leaps over a frozen creek.") });
    expect(await createChatPromptWriter({ apiKey: "k", fetch: f }).write(request)).toBe("A red fox leaps over a frozen creek.");
  });

  it("throws when the answer was cut off, so no fragment reaches the model", async () => {
    const cut = { choices: [{ finish_reason: "length", message: { content: '{"prompt": "Golden hour, backlight, medium shot, a barista pours' } }] };
    const { f } = fakeFetch({ body: cut });
    await expect(createChatPromptWriter({ apiKey: "k", fetch: f }).write(request)).rejects.toThrow(/cut off/);
  });

  it("throws on broken JSON instead of passing it on as a prompt", async () => {
    const { f } = fakeFetch({ body: reply('{"prompt": "A red fox leaps') });
    await expect(createChatPromptWriter({ apiKey: "k", fetch: f }).write(request)).rejects.toThrow(/JSON/);
  });

  it("reads the prompt out of a JSON answer wrapped in a code fence", async () => {
    const { f } = fakeFetch({ body: reply('```json\n{"prompt": "A red fox leaps over a frozen creek."}\n```') });
    expect(await createChatPromptWriter({ apiKey: "k", fetch: f }).write(request)).toBe("A red fox leaps over a frozen creek.");
  });

  it("throws on an error answer, so the job falls back to the user's prompt", async () => {
    const { f } = fakeFetch({ status: 502, body: { error: "bad gateway" } });
    await expect(createChatPromptWriter({ apiKey: "k", fetch: f }).write(request)).rejects.toThrow(/502/);
  });
});
