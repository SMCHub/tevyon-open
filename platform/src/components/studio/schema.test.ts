import { describe, expect, it } from "vitest";
import { choices, modelFacts, optionKeys, type JsonSchema } from "./schema";

const video = (props: Record<string, JsonSchema>): JsonSchema => ({ type: "object", properties: { prompt: { type: "string" }, ...props } });

describe("model facts for the model list", () => {
  it("names the highest resolution, the duration span and sound", () => {
    const seedance = video({
      duration: { type: "integer", minimum: 4, maximum: 15 },
      resolution: { enum: ["480p", "720p", "1080p", "4K"] },
      generate_audio: { type: "boolean" },
    });
    expect(modelFacts(seedance)).toEqual(["4K", "4–15 s", "Ton"]);
  });

  it("ranks 2K above 1080p and 768p above 720p, whatever the order of the list", () => {
    expect(modelFacts(video({ resolution: { enum: ["2K"] } }))[0]).toBe("2K");
    expect(modelFacts(video({ resolution: { enum: ["768p", "480p"] } }))[0]).toBe("768p");
    expect(modelFacts(video({ resolution: { enum: ["1080p", "2K", "720p"] } }))[0]).toBe("2K");
  });

  it("reads fixed durations from a list and a single one as one value", () => {
    expect(modelFacts(video({ duration: { anyOf: [{ const: 4 }, { const: 6 }, { const: 8 }] } }))).toEqual(["4–8 s"]);
    expect(modelFacts(video({ duration: { enum: [5] } }))).toEqual(["5 s"]);
  });

  it("says nothing it cannot read from the parameters", () => {
    expect(modelFacts(video({ aspect_ratio: { enum: ["16:9", "9:16"] } }))).toEqual([]);
  });
});

describe("options as controls", () => {
  it("offers every whole second of a long video, up to 30 seconds", () => {
    expect(choices({ type: "integer", minimum: 2, maximum: 30 })).toHaveLength(29);
    expect(choices({ type: "integer", minimum: 4, maximum: 30 })).toEqual(Array.from({ length: 27 }, (_, i) => i + 4));
    expect(optionKeys(video({ duration: { type: "integer", minimum: 4, maximum: 30 } }))).toEqual(["duration"]);
  });
});
