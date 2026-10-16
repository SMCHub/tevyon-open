import { cronAccess } from "@/server/cron";
import { STALE_HOLD_MS } from "@/server/director";
import { oauth } from "@/server/keys";
import { rateLimiter } from "@/server/rate-limits";
import { runtime } from "@/server/runtime";

/**
 * Daily OAuth cleanup (vercel.json, 04:00 UTC): expired codes, device logins and tokens, clients that registered but
 * never got a login within a week, and ended rate-limit windows (src/core/oauth.ts, cleanup); also the operator
 * overview's counts of turned-away starts older than 90 days, and Director holds of messages that never ended. Vercel sends `Authorization: Bearer $CRON_SECRET`;
 * without the secret nothing runs.
 */
export async function GET(req: Request) {
  const access = cronAccess(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (access !== "ok") return Response.json({ ok: false, error: access }, { status: access === "not_configured" ? 503 : 401 });
  const removed = await oauth().cleanup();
  const rateLimits = await rateLimiter().purge();
  const rt = await runtime();
  // Director holds of messages that never ended (the next message of the account frees its own as well).
  const staleHolds = await rt.repo.voidStaleHolds(Date.now() - STALE_HOLD_MS);
  return Response.json({ ok: true, removed: { ...removed, rateLimits, staleHolds } });
}
