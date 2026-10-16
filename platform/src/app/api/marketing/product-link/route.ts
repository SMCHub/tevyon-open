import { parseProductPage } from "@/core/product-link";
import { currentAccount, unauthorized } from "@/server/account";
import { fetchRemoteImage, fetchRemotePage } from "@/server/remote-image";
import { acceptAccountUpload } from "@/server/uploads";

/**
 * POST /api/marketing/product-link with { url }: reads a public shop page (SSRF-safe) and returns a product profile
 * with name, description and up to five images, each already copied into the caller's own uploads (so they can be
 * used as references) after the upload scan; a blocked or unscannable image is left out. The shop page itself is not stored.
 */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== "string" || body.url.length > 2000) return Response.json({ ok: false, error: "bad_url" }, { status: 400 });
  const page = await fetchRemotePage(body.url.trim());
  if (!page.ok) return Response.json({ ok: false, error: page.error }, { status: page.error === "bad_url" || page.error === "blocked_address" ? 400 : 502 });

  const product = parseProductPage(page.html, page.url);
  const images = (
    await Promise.all(
      product.images.map(async (src) => {
        const img = await fetchRemoteImage(src);
        if (!img.ok) return undefined;
        const res = await acceptAccountUpload(account.id, img.data);
        return res.ok ? res.url : undefined;
      }),
    )
  ).filter((u): u is string => Boolean(u));
  if (!product.name && images.length === 0) return Response.json({ ok: false, error: "no_product_found" }, { status: 422 });
  return Response.json({ ok: true, product: { name: product.name, description: product.description, images, source: page.url } });
}

/** The upload scan takes seconds (up to a minute for a video): more than the platform's default request time. */
export const maxDuration = 90;
