import { describe, expect, it } from "vitest";
import { restore, toHistory, type Msg } from "./thread";

const custom = { type: "custom" as const, jobType: "kling_3_turbo", kind: "video" as const, model: "Kling 3.0 Turbo", prompt: "A dog jumps through a glowing portal", params: { prompt: "x", aspect_ratio: "9:16", duration: 5 }, why: "Hook", credits: 95 };
const image = { type: "custom" as const, jobType: "flux_3_image", kind: "image" as const, model: "FLUX 3", prompt: "A red fox in snow", params: { prompt: "x" }, why: "Still", credits: 15 };

describe("Director thread", () => {
  it("tells the model what it proposed, numbered, and which proposals the user started and how they ended", () => {
    const msgs: Msg[] = [
      { role: "user", content: "dog viral" },
      { role: "assistant", content: "I am turning your dog into a clip.", proposals: [custom, image], started: { 0: "job-1", 1: "job-2" }, suggestions: ["Make it darker"] },
      { role: "user", content: "One more" },
    ];
    const status = (id: string) => (id === "job-1" ? "succeeded" : "failed");
    expect(toHistory(msgs, status)).toEqual([
      { role: "user", content: "dog viral" },
      {
        role: "assistant",
        content:
          "I am turning your dog into a clip.\n[Proposals: 1) Kling 3.0 Turbo, 9:16, 5 s: A dog jumps through a glowing portal (started, done) | 2) FLUX 3: A red fox in snow (started, failed)]",
      },
      { role: "user", content: "One more" },
    ]);
  });

  it("marks a running proposal as started and leaves out answers that failed, stopped or never said anything", () => {
    const msgs: Msg[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "I am planning", proposals: [custom], started: { 0: "job-1" } },
      { role: "user", content: "b" },
      { role: "assistant", content: "I cannot get through right now.", proposals: [], started: {}, state: "failed" },
      { role: "user", content: "c" },
      { role: "assistant", content: "Half", proposals: [], started: {}, state: "stopped" },
      { role: "user", content: "d" },
      { role: "assistant", content: "  ", proposals: [], started: {} },
    ];
    const out = toHistory(msgs, () => "running");
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user", "user", "user"]);
    expect(out[1]!.content).toMatch(/\(started\)\]$/);
  });

  it("shortens long prompts in the marker, so the server's 2,000 characters per message keep every status", () => {
    const long = { ...custom, prompt: "A dog ".repeat(200) };
    const msgs: Msg[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "I am making you three portrait clips.", proposals: [long, long, long], started: { 2: "job-9" } },
    ];
    const content = toHistory(msgs, () => "succeeded")[1]!.content;
    expect(content.length).toBeLessThan(2000);
    expect(content).toMatch(/3\) .*\(started, done\)\]$/);
    expect(content).toContain("…");
  });

  it("brings a chat saved mid-answer back as a stopped answer, and drops one that was still waiting", () => {
    const msgs: Msg[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "I am making", proposals: [], started: {}, state: "streaming" },
      { role: "user", content: "b" },
      { role: "assistant", content: "", proposals: [], started: {}, state: "waiting" },
    ];
    expect(restore(msgs)).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "I am making", proposals: [], started: {}, state: "stopped" },
      { role: "user", content: "b" },
    ]);
  });

  it("drops proposals of an older version (presets) from a saved chat, keeping the started jobs of the others", () => {
    const old = { type: "preset", presetId: "sag-es", title: "Sag es!", why: "x", credits: 85 } as unknown as typeof custom;
    const [, answer] = restore([
      { role: "user", content: "a" },
      { role: "assistant", content: "Zwei Ideen", proposals: [old, custom], started: { 0: "job-0", 1: "job-1" } },
    ]);
    expect(answer).toMatchObject({ proposals: [custom], started: { 0: "job-1" } });
  });
});
