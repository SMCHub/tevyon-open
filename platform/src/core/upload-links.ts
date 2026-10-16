import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed upload links for agents with a shell (Claude Code): one image into one account, for fifteen minutes,
 * without the API key leaving the MCP connection. HMAC over "upload|account|id|exp" (purpose prefix, so it can
 * never pass as a media link signed with the same secret).
 */
export function createUploadLinks(deps: { secret: string; now?: () => number; ttlSeconds?: number }) {
  const { secret, now = Date.now, ttlSeconds = 15 * 60 } = deps;
  if (secret.length < 32) throw new Error("upload link secret must be at least 32 characters");
  const mac = (acc: string, id: string, exp: string) => createHmac("sha256", secret).update(`upload|${acc}|${id}|${exp}`).digest();

  /** Query parameters for PUT /api/uploads/signed. */
  function sign(accountId: string, id: string): URLSearchParams {
    const exp = String(Math.floor(now() / 1000) + ttlSeconds);
    return new URLSearchParams({ acc: accountId, id, exp, sig: mac(accountId, id, exp).toString("base64url") });
  }

  function verify(q: URLSearchParams): { accountId: string; id: string } | null {
    const acc = q.get("acc") ?? "";
    const id = q.get("id") ?? "";
    const exp = q.get("exp") ?? "";
    const sig = q.get("sig") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(acc) || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^\d{1,12}$/.test(exp) || !sig) return null;
    if (Number(exp) * 1000 < now()) return null;
    const given = Buffer.from(sig, "base64url");
    const expected = mac(acc, id, exp);
    return given.length === expected.length && timingSafeEqual(given, expected) ? { accountId: acc, id } : null;
  }

  return { sign, verify, ttlSeconds };
}

export type UploadLinks = ReturnType<typeof createUploadLinks>;
