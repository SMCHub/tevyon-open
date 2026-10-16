/**
 * "Product link" of the Marketing Agent: from a shop page to a product profile (name, description, up to five
 * images), like a brand-kit scrape. Pure parsing; fetching is the server's job (SSRF-safe).
 */
export type ProductPage = { name: string; description: string; images: string[] };

export const MAX_PRODUCT_IMAGES = 5;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 600;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}
const tidy = (s: string | undefined, max: number) => decode(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The content of every <meta> whose property or name is one of `keys`, in page order. */
function metas(html: string, keys: string[]): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content !== undefined && keys.includes(key)) out.push(content);
  }
  return out;
}

type Json = Record<string, unknown>;
/** The first schema.org Product in the page's JSON-LD blocks (also inside @graph and arrays). */
function jsonLdProduct(html: string): Json | undefined {
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.shift();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === "object") {
        const o = node as Json;
        const type = o["@type"];
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return o;
        if (o["@graph"]) stack.push(o["@graph"]);
      }
    }
  }
  return undefined;
}

function imageUrls(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(imageUrls);
  if (v && typeof v === "object" && typeof (v as Json).url === "string") return [(v as Json).url as string];
  return [];
}

/** Absolute https URL, or nothing (data:, http:, javascript: … are dropped). */
function absolute(raw: string, base: string): string | undefined {
  try {
    const u = new URL(decode(raw.trim()), base);
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parseProductPage(html: string, baseUrl: string): ProductPage {
  const ld = jsonLdProduct(html);
  const name = tidy(
    (typeof ld?.name === "string" ? ld.name : undefined) ?? metas(html, ["og:title", "twitter:title"])[0] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1],
    NAME_MAX,
  );
  const description = tidy(
    (typeof ld?.description === "string" ? ld.description : undefined) ?? metas(html, ["og:description", "description", "twitter:description"])[0],
    DESCRIPTION_MAX,
  );
  const candidates = [...imageUrls(ld?.image), ...metas(html, ["og:image", "og:image:secure_url", "og:image:url", "twitter:image"])];
  const images: string[] = [];
  for (const c of candidates) {
    const url = absolute(c, baseUrl);
    if (url && !images.includes(url)) images.push(url);
    if (images.length === MAX_PRODUCT_IMAGES) break;
  }
  return { name, description, images };
}
