import { describe, expect, it } from "vitest";
import { mentionAt, mentionParts, renumberAfterRemoval, replaceMention } from "./references";

describe("reference mentions in the prompt", () => {
  it("drops the mentions of a removed reference and moves the later ones up", () => {
    expect(renumberAfterRemoval("Katze aus @Bild1 im Raum von @Bild2, Licht wie @Bild3", 2)).toBe("Katze aus @Bild1 im Raum von , Licht wie @Bild2");
    expect(renumberAfterRemoval("@image1 und @img3", 1)).toBe(" und @Bild2");
  });

  it("finds the @-word the user is typing right before the caret, not an e-mail address", () => {
    expect(mentionAt("Katze aus @Bi", 13)).toEqual({ start: 10, query: "Bi" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("mail an a@b", 11)).toBeNull();
    expect(mentionAt("@Bild1 sitzt", 12)).toBeNull();
  });
});

describe("mentioning images picked from the assets", () => {
  it("replaces the @-word being typed with the names of the new references and puts the caret after them", () => {
    expect(replaceMention("ändere die Person auf dem @", 26, 27, [1])).toEqual({ text: "ändere die Person auf dem @Bild1 ", caret: 33 });
    expect(replaceMention("Mische @ und den Rest", 7, 8, [2, 3])).toEqual({ text: "Mische @Bild2 @Bild3 und den Rest", caret: 20 });
  });
});

describe("marking the mentions in the prompt field", () => {
  it("splits the prompt into text and mentions, the text unchanged, a mention without its image marked loose", () => {
    const text = "Gesicht von @Bild1 auf @bild 2, Licht wie @image3.";
    const parts = mentionParts(text, 2);
    expect(parts).toEqual([
      { text: "Gesicht von " },
      { text: "@Bild1", n: 1, attached: true },
      { text: " auf " },
      { text: "@bild 2", n: 2, attached: true },
      { text: ", Licht wie " },
      { text: "@image3", n: 3, attached: false },
      { text: "." },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(mentionParts("mail an a@b und @Bilder", 1)).toEqual([{ text: "mail an a@b und @Bilder" }]);
    expect(mentionParts("", 0)).toEqual([]);
  });
});
