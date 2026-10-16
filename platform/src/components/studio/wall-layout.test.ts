import { describe, expect, it } from "vitest";
import { columnsFor, distribute, posterType, tileNo } from "./wall-layout";

describe("image wall columns", () => {
  it("fits as many columns of a least width into the wall as there is room for, one to four", () => {
    // Image studio (columns of at least 330 px): a phone, a tablet, a laptop, a large screen.
    expect(columnsFor(358, 330)).toBe(1);
    expect(columnsFor(900, 330)).toBe(2);
    expect(columnsFor(1348, 330)).toBe(3);
    expect(columnsFor(1600, 330)).toBe(4);
    expect(columnsFor(2600, 330)).toBe(4);
    // Video stage beside the panel (columns of at least 280 px).
    expect(columnsFor(600, 280)).toBe(2);
    expect(columnsFor(950, 280)).toBe(3);
    expect(columnsFor(0, 280)).toBe(1);
  });

  it("packs a dense wall tighter: small columns, thin gaps, up to a given maximum", () => {
    // Image studio in the Midjourney build: columns of at least 240 px, 4 px gaps, at most four.
    expect(columnsFor(358, 240, 4, 4)).toBe(1);
    expect(columnsFor(740, 240, 4, 4)).toBe(3);
    expect(columnsFor(1000, 240, 4, 4)).toBe(4);
    expect(columnsFor(2600, 240, 4, 4)).toBe(4);
  });

  it("puts every tile into the shortest column, the left one on a tie, so the numbers run along the rows", () => {
    expect(distribute([1, 1, 1], 3)).toEqual([[0], [1], [2]]);
    // A tall first tile: the next two go to the other column until it has caught up.
    expect(distribute([2, 1, 1, 1], 2, { gap: 0 })).toEqual([[0, 3], [1, 2]]);
  });

  it("fills the first row from left to right whatever the tiles' shapes", () => {
    expect(distribute([1.78, 0.56, 1, 1.5], 3).slice(0, 3).map((c) => c[0])).toEqual([0, 1, 2]);
    // Then the column holding least takes the next tile: here the wide one in the middle.
    expect(distribute([1.78, 0.56, 1, 1.5], 3)[1]).toEqual([1, 3]);
  });

  it("keeps every tile exactly once, also without tiles or columns", () => {
    const heights = [1.5, 0.56, 1, 1.78, 0.67, 1, 1.33, 1.5];
    expect(distribute(heights, 3).flat().sort((a, b) => a - b)).toEqual(heights.map((_, i) => i));
    expect(distribute([], 3)).toEqual([[], [], []]);
    expect(distribute([1, 1], 0)).toEqual([[0, 1]]);
  });

  it("numbers tiles with as many digits as the count needs, at least two", () => {
    expect(tileNo(0, 6)).toBe("01");
    expect(tileNo(6, 186)).toBe("007");
    expect(tileNo(185, 186)).toBe("186");
  });
});

describe("poster type", () => {
  it("splits a short title into rows of up to three letters, two cells to a row", () => {
    expect(posterType("Anthrazit")).toEqual({ kind: "split", rows: [["AN", "T"], ["HR", "A"], ["ZI", "T"]] });
    expect(posterType("Latte Art")).toEqual({ kind: "split", rows: [["LA", "T"], ["TE", "A"], ["RT"]] });
    expect(posterType("Omakase")).toEqual({ kind: "split", rows: [["OM", "A"], ["K", "A"], ["SE"]] });
    // Never a lone letter in the last row: four letters make two rows of two.
    expect(posterType("Löwe")).toEqual({ kind: "split", rows: [["LÖ"], ["W", "E"]] });
    expect(posterType("Streetwear")).toEqual({ kind: "split", rows: [["ST", "R"], ["EE", "T"], ["WE"], ["A", "R"]] });
  });

  it("sets long titles and titles with a hyphen or slash as plain lines, broken at words", () => {
    expect(posterType("Fuchs im Schnee")).toEqual({ kind: "lines", lines: ["FUCHS IM", "SCHNEE"] });
    expect(posterType("Dünen-Couture")).toEqual({ kind: "lines", lines: ["DÜNEN-", "COUTURE"] });
    expect(posterType("Neon-Gasse")).toEqual({ kind: "lines", lines: ["NEON-GASSE"] });
    expect(posterType("Vorher / Nachher Putzen")).toEqual({ kind: "lines", lines: ["VORHER /", "NACHHER", "PUTZEN"] });
    expect(posterType("Schwarz-Weiss-Claim")).toEqual({ kind: "lines", lines: ["SCHWARZ-", "WEISS-", "CLAIM"] });
  });
});
