import { describe, expect, it } from "vitest";
import { mentionAt, mentionParts, renumberAfterRemoval, replaceMention } from "./references";

describe("reference mentions in the prompt", () => {
  it("drops the mentions of a removed reference and moves the later ones up", () => {
    expect(renumberAfterRemoval("Cat from @image1 in the room of @image2, light like @image3", 2)).toBe("Cat from @image1 in the room of , light like @image2");
    // Older prompts may still say @Bild; they are understood and renumbered all the same.
    expect(renumberAfterRemoval("@Bild1 and @img3", 1)).toBe(" and @image2");
  });

  it("finds the @-word the user is typing right before the caret, not an e-mail address", () => {
    expect(mentionAt("Cat from @im", 12)).toEqual({ start: 9, query: "im" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("mail to a@b", 11)).toBeNull();
    expect(mentionAt("@image1 sits", 12)).toBeNull();
  });
});

describe("mentioning images picked from the assets", () => {
  it("replaces the @-word being typed with the names of the new references and puts the caret after them", () => {
    expect(replaceMention("change the person in @", 21, 22, [1])).toEqual({ text: "change the person in @image1 ", caret: 29 });
    expect(replaceMention("Blend @ and the rest", 6, 7, [2, 3])).toEqual({ text: "Blend @image2 @image3 and the rest", caret: 21 });
  });
});

describe("marking the mentions in the prompt field", () => {
  it("splits the prompt into text and mentions, the text unchanged, a mention without its image marked loose", () => {
    const text = "Face from @image1 on @bild 2, light like @img3.";
    const parts = mentionParts(text, 2);
    expect(parts).toEqual([
      { text: "Face from " },
      { text: "@image1", n: 1, attached: true },
      { text: " on " },
      { text: "@bild 2", n: 2, attached: true },
      { text: ", light like " },
      { text: "@img3", n: 3, attached: false },
      { text: "." },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(mentionParts("mail to a@b and @images", 1)).toEqual([{ text: "mail to a@b and @images" }]);
    expect(mentionParts("", 0)).toEqual([]);
  });
});
