import { describe, expect, it } from "vitest";
import { parseProductPage } from "./product-link";

const BASE = "https://shop.example.ch/p/serum";

describe("product link: reading a shop page", () => {
  it("prefers the JSON-LD Product (name, description, every image)", () => {
    const html = `<html><head>
      <meta property="og:title" content="Serum | Shop">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Shop"},
        {"@type":"Product","name":"Glow Serum 30 ml","description":"Vitamin C &amp; Hyaluron.","image":["/img/a.jpg","https://cdn.example.ch/b.webp"]}]}</script>
    </head></html>`;
    expect(parseProductPage(html, BASE)).toEqual({
      name: "Glow Serum 30 ml",
      description: "Vitamin C & Hyaluron.",
      images: ["https://shop.example.ch/img/a.jpg", "https://cdn.example.ch/b.webp"],
    });
  });

  it("falls back to Open Graph and the title", () => {
    const html = `<head><title>Fallback Title</title>
      <meta content="Organic Lemonade" property="og:title"/>
      <meta name="description" content="With ginger and lemon">
      <meta property="og:image" content="//cdn.example.ch/limo.png">
      <meta property="og:image:secure_url" content="https://cdn.example.ch/limo-2.png"></head>`;
    expect(parseProductPage(html, BASE)).toEqual({
      name: "Organic Lemonade",
      description: "With ginger and lemon",
      images: ["https://cdn.example.ch/limo.png", "https://cdn.example.ch/limo-2.png"],
    });
  });

  it("keeps at most five https images, without duplicates or data URLs", () => {
    const imgs = ["a", "b", "a", "c", "d", "e", "f"].map((n) => `<meta property="og:image" content="https://x.ch/${n}.jpg">`).join("");
    const html = `<title>T</title>${imgs}<meta property="og:image" content="data:image/png;base64,AAA"><meta property="og:image" content="http://plain.ch/x.jpg">`;
    expect(parseProductPage(html, BASE).images).toEqual(["a", "b", "c", "d", "e"].map((n) => `https://x.ch/${n}.jpg`));
  });

  it("survives broken JSON-LD and caps long texts", () => {
    const html = `<title>${"N".repeat(300)}</title><script type="application/ld+json">{broken</script><meta name="description" content="${"d".repeat(2000)}">`;
    const p = parseProductPage(html, BASE);
    expect(p.name.length).toBeLessThanOrEqual(120);
    expect(p.description.length).toBeLessThanOrEqual(600);
    expect(p.images).toEqual([]);
  });
});
