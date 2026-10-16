import { createHmac, timingSafeEqual } from "node:crypto";

const MEDIA_PREFIX = "/api/media/";

/**
 * Signed, expiring links to Tachyon's own media (/api/media/…). Agents and other clients outside
 * the browser have no login cookie; a signed link opens the file until it expires.
 * Signature: HMAC-SHA256 over "key|exp" with a server secret, base64url.
 */
export function createMediaLinks(deps: { secret: string; now?: () => number; ttlSeconds?: number }) {
  const { secret, now = Date.now, ttlSeconds = 7 * 24 * 3600 } = deps;
  if (secret.length < 32) throw new Error("media link secret must be at least 32 characters");

  const mac = (key: string, exp: string) => createHmac("sha256", secret).update(`${key}|${exp}`).digest();

  /** Signs a media URL path (from a job's outputs). With a base, the link is absolute. */
  function sign(mediaPath: string, base?: string): string {
    if (!mediaPath.startsWith(MEDIA_PREFIX)) throw new Error("only Tachyon media can be signed");
    const key = mediaPath.slice(MEDIA_PREFIX.length);
    const exp = String(Math.floor(now() / 1000) + ttlSeconds);
    const path = `${mediaPath}?exp=${exp}&sig=${mac(key, exp).toString("base64url")}`;
    return base ? new URL(path, base).toString() : path;
  }

  /** True if the signature matches this media key and has not expired. */
  function verify(key: string, exp: string | null, sig: string | null): boolean {
    if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
    if (Number(exp) * 1000 < now()) return false;
    const given = Buffer.from(sig, "base64url");
    const expected = mac(key, exp);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  return { sign, verify };
}

export type MediaLinks = ReturnType<typeof createMediaLinks>;
