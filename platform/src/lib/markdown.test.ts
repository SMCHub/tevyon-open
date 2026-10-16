import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("chat markdown: inline", () => {
  it("reads bold, emphasis and code, and leaves the rest as text", () => {
    expect(parseInline("a **Kling clip** with a *camera move* and `9:16`")).toEqual([
      { t: "text", v: "a " },
      { t: "strong", c: [{ t: "text", v: "Kling clip" }] },
      { t: "text", v: " with a " },
      { t: "em", c: [{ t: "text", v: "camera move" }] },
      { t: "text", v: " and " },
      { t: "code", v: "9:16" },
    ]);
  });

  it("keeps markers that are not closed, as while an answer streams in", () => {
    expect(parseInline("a **Kling")).toEqual([{ t: "text", v: "a **Kling" }]);
    expect(parseInline("5 * 3 = 15")).toEqual([{ t: "text", v: "5 * 3 = 15" }]);
  });

  it("reads emphasis inside bold", () => {
    expect(parseInline("**very *fast***")).toEqual([
      { t: "strong", c: [{ t: "text", v: "very " }, { t: "em", c: [{ t: "text", v: "fast" }] }] },
    ]);
  });
});

describe("chat markdown: blocks", () => {
  it("splits paragraphs at blank lines and keeps single line breaks", () => {
    expect(parseMarkdown("Strong idea!\nSecond line.\n\nNew paragraph.")).toEqual([
      { t: "p", lines: [[{ t: "text", v: "Strong idea!" }], [{ t: "text", v: "Second line." }]] },
      { t: "p", lines: [[{ t: "text", v: "New paragraph." }]] },
    ]);
  });

  it("reads bullet and numbered lists, also right after a paragraph line", () => {
    expect(parseMarkdown("Three ways:\n- **Preset**\n* Clip\n• Image\n\n1. Hook\n2) Cut")).toEqual([
      { t: "p", lines: [[{ t: "text", v: "Three ways:" }]] },
      { t: "ul", items: [[{ t: "strong", c: [{ t: "text", v: "Preset" }] }], [{ t: "text", v: "Clip" }], [{ t: "text", v: "Image" }]] },
      { t: "ol", start: 1, items: [[{ t: "text", v: "Hook" }], [{ t: "text", v: "Cut" }]] },
    ]);
  });

  it("reads headings and quotes, keeps a list's start number", () => {
    expect(parseMarkdown("### Plan\n> Hook first\n3. Three")).toEqual([
      { t: "h", c: [{ t: "text", v: "Plan" }] },
      { t: "quote", lines: [[{ t: "text", v: "Hook first" }]] },
      { t: "ol", start: 3, items: [[{ t: "text", v: "Three" }]] },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });
});
