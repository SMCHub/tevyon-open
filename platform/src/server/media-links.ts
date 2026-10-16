import { createMediaLinks, type MediaLinks } from "@/core/media-links";

let links: MediaLinks | undefined;

/** Signed links to our own media for clients without a login cookie (MCP). Needs MEDIA_LINK_SECRET. */
export function mediaLinks(): MediaLinks {
  const secret = process.env.MEDIA_LINK_SECRET;
  if (!secret) throw new Error("MEDIA_LINK_SECRET is missing (platform/.env.local)");
  return (links ??= createMediaLinks({ secret }));
}

/** True for a valid, unexpired signed link. Without a secret no link is valid (and none was ever issued). */
export function isSignedMediaRequest(key: string, url: URL): boolean {
  const sig = url.searchParams.get("sig");
  if (!sig || !process.env.MEDIA_LINK_SECRET) return false;
  return mediaLinks().verify(key, url.searchParams.get("exp"), sig);
}

/**
 * The origin clients reach this server at. PUBLIC_BASE_URL wins; behind a proxy the forwarded host counts, the same
 * way pageOrigin() sees it, so the OAuth issuer is identical on pages and in route handlers.
 */
export function publicBase(req: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  const host = req.headers.get("x-forwarded-host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
