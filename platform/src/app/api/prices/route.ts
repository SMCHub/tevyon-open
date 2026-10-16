import { catalog } from "@/core/catalog";
import { priceList } from "@/core/price-list";

/** Public price list: every model in credits, from its cheapest and at its standard settings (core/price-list.ts). */
export function GET() {
  return Response.json({ prices: priceList(catalog) }, { headers: { "cache-control": "public, max-age=300" } });
}
