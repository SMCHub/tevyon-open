import { describe, expect, it } from "vitest";
import { splitTitle, twoLines } from "./poster-type";

const chunks = (title: string) => splitTitle(title).rows.map((r) => r.chunks);

describe("splitTitle", () => {
  it("breaks every word into two chunks, short words two plus the rest", () => {
    expect(chunks("Sag es!")).toEqual([["SA", "G"], ["ES", "!"]]);
    expect(chunks("Werbespot mit Sprecher")).toEqual([["WERBE", "SPOT"], ["MI", "T"], ["SPRE", "CHER"]]);
  });

  it("keeps words of one or two letters whole", () => {
    expect(chunks("Go")).toEqual([["GO"]]);
  });

  it("breaks hyphenated words after the hyphen", () => {
    expect(chunks("Zutaten-Explosion")).toEqual([["ZUTA", "TEN-"], ["EXPLO", "SION"]]);
  });

  it("uses German capitals", () => {
    expect(chunks("Fuß")).toEqual([["FU", "SS"]]);
  });

  it("joins the shortest neighbours until four rows are left, keeping their words whole", () => {
    expect(chunks("Ein Zwei Drei Vier Fünfte")).toEqual([["EIN", "ZWEI"], ["DR", "EI"], ["VI", "ER"], ["FÜN", "FTE"]]);
  });

  it("staggers the rows", () => {
    const indents = splitTitle("Werbespot mit Sprecher").rows.map((r) => r.indent);
    expect(new Set(indents).size).toBe(3);
    expect(indents[0]).toBe(0);
  });

  it("measures the widest row in em, indent and break included, so the type can be fitted to its box", () => {
    const { rows, width } = splitTitle("Sag es!");
    expect(width).toBeGreaterThan(0);
    expect(width).toBeGreaterThan(rows[1]!.indent);
    expect(splitTitle("Werbespot mit Sprecher").width).toBeGreaterThan(width);
  });

  it("returns nothing for an empty title", () => {
    expect(splitTitle("  ")).toEqual({ rows: [], width: 0 });
  });
});

describe("twoLines", () => {
  it("breaks after the comma nearest the middle", () => {
    expect(twoLines("Dein Foto spricht deinen Satz, lippensynchron")).toEqual(["Dein Foto spricht deinen Satz,", "lippensynchron"]);
    expect(twoLines("Dein Produkt, dein Slogan, gesprochen wie im TV-Spot")).toEqual(["Dein Produkt, dein Slogan,", "gesprochen wie im TV-Spot"]);
  });

  it("breaks at the space nearest the middle without a comma", () => {
    expect(twoLines("Vom Packshot in eine echte Wohnung")).toEqual(["Vom Packshot in", "eine echte Wohnung"]);
  });

  it("keeps a single word on the first line", () => {
    expect(twoLines("Zeitlupe")).toEqual(["Zeitlupe", ""]);
  });
});
