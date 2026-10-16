import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("chat markdown: inline", () => {
  it("reads bold, emphasis and code, and leaves the rest as text", () => {
    expect(parseInline("ein **Kling-Clip** mit *Kamerafahrt* und `9:16`")).toEqual([
      { t: "text", v: "ein " },
      { t: "strong", c: [{ t: "text", v: "Kling-Clip" }] },
      { t: "text", v: " mit " },
      { t: "em", c: [{ t: "text", v: "Kamerafahrt" }] },
      { t: "text", v: " und " },
      { t: "code", v: "9:16" },
    ]);
  });

  it("keeps markers that are not closed, as while an answer streams in", () => {
    expect(parseInline("ein **Kling")).toEqual([{ t: "text", v: "ein **Kling" }]);
    expect(parseInline("5 * 3 = 15")).toEqual([{ t: "text", v: "5 * 3 = 15" }]);
  });

  it("reads emphasis inside bold", () => {
    expect(parseInline("**sehr *schnell***")).toEqual([
      { t: "strong", c: [{ t: "text", v: "sehr " }, { t: "em", c: [{ t: "text", v: "schnell" }] }] },
    ]);
  });
});

describe("chat markdown: blocks", () => {
  it("splits paragraphs at blank lines and keeps single line breaks", () => {
    expect(parseMarkdown("Starke Idee!\nZweite Zeile.\n\nNeuer Absatz.")).toEqual([
      { t: "p", lines: [[{ t: "text", v: "Starke Idee!" }], [{ t: "text", v: "Zweite Zeile." }]] },
      { t: "p", lines: [[{ t: "text", v: "Neuer Absatz." }]] },
    ]);
  });

  it("reads bullet and numbered lists, also right after a paragraph line", () => {
    expect(parseMarkdown("Drei Wege:\n- **Preset**\n* Clip\n• Bild\n\n1. Hook\n2) Schnitt")).toEqual([
      { t: "p", lines: [[{ t: "text", v: "Drei Wege:" }]] },
      { t: "ul", items: [[{ t: "strong", c: [{ t: "text", v: "Preset" }] }], [{ t: "text", v: "Clip" }], [{ t: "text", v: "Bild" }]] },
      { t: "ol", start: 1, items: [[{ t: "text", v: "Hook" }], [{ t: "text", v: "Schnitt" }]] },
    ]);
  });

  it("reads headings and quotes, keeps a list's start number", () => {
    expect(parseMarkdown("### Plan\n> Hook zuerst\n3. Drei")).toEqual([
      { t: "h", c: [{ t: "text", v: "Plan" }] },
      { t: "quote", lines: [[{ t: "text", v: "Hook zuerst" }]] },
      { t: "ol", start: 3, items: [[{ t: "text", v: "Drei" }]] },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });
});
