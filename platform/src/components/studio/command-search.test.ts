import { describe, expect, it } from "vitest";
import { searchCommands, type Command } from "./command-search";

const cmd = (id: string, label: string, extra: Partial<Command> = {}): Command => ({ id, group: "Pages", label, ...extra });
const ALL: Command[] = [
  cmd("explore", "Explore"),
  cmd("image", "Image"),
  cmd("video", "Video"),
  cmd("i2v", "Image → Video"),
  cmd("presets", "Presets"),
  cmd("credits", "Credits", { keywords: ["cost", "top up", "prices"] }),
  cmd("seedream", "Seedream 4.5", { group: "Models", hint: "Image model" }),
  cmd("veo", "Veo 3.1", { group: "Models", hint: "Video model" }),
  cmd("surprise", "Café crème", { group: "Actions" }),
];
const ids = (q: string) => searchCommands(ALL, q).map((c) => c.id);

describe("command search", () => {
  it("keeps every command in its order while nothing is typed", () => {
    expect(ids("")).toEqual(ALL.map((c) => c.id));
    expect(ids("   ")).toEqual(ALL.map((c) => c.id));
  });

  it("puts a label that starts with the query before one that only contains it", () => {
    expect(ids("vid")).toEqual(["video", "i2v", "veo"]);
  });

  it("finds a command by its keywords", () => {
    expect(ids("cost")).toEqual(["credits"]);
  });

  it("ignores case and accents", () => {
    expect(ids("CAFE CREME")).toEqual(["surprise"]);
  });

  it("needs every word of the query to match", () => {
    expect(ids("seed 4.5")).toEqual(["seedream"]);
    expect(ids("seed 9")).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(ids("xyz")).toEqual([]);
  });

  it("stops at the limit", () => {
    expect(searchCommands(ALL, "", 3)).toHaveLength(3);
  });
});
