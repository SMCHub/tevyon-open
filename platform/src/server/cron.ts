import { timingSafeEqual } from "node:crypto";

/**
 * Cron calls (vercel.json) carry `Authorization: Bearer $CRON_SECRET`. Without a configured secret nothing runs:
 * "not_configured" (fail closed). The comparison takes the same time for every wrong secret.
 */
export function cronAccess(authorization: string | null, secret: string | undefined): "ok" | "not_configured" | "unauthorized" {
  if (!secret) return "not_configured";
  const given = Buffer.from(authorization ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want) ? "ok" : "unauthorized";
}
