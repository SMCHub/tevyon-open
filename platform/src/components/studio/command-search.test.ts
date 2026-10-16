import { describe, expect, it } from "vitest";
import { searchCommands, type Command } from "./command-search";

const cmd = (id: string, label: string, extra: Partial<Command> = {}): Command => ({ id, group: "Seiten", label, ...extra });
const ALL: Command[] = [
  cmd("explore", "Entdecken"),
  cmd("image", "Bild"),
  cmd("video", "Video"),
  cmd("i2v", "Bild → Video"),
  cmd("presets", "Presets"),
  cmd("credits", "Credits", { keywords: ["kosten", "aufladen", "preise"] }),
  cmd("seedream", "Seedream 4.5", { group: "Modelle", hint: "Bild-Modell" }),
  cmd("veo", "Veo 3.1", { group: "Modelle", hint: "Video-Modell" }),
  cmd("surprise", "Überrasch mich", { group: "Aktionen" }),
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
    expect(ids("kosten")).toEqual(["credits"]);
  });

  it("ignores case and accents", () => {
    expect(ids("UBERRASCH")).toEqual(["surprise"]);
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
