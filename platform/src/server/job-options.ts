import type { Account } from "./account";

const DAY_MS = 86_400_000;

/**
 * The billing-relevant start() options of a request, the same for every route that starts jobs:
 * channel (Studio → web, CLI → cli, other API clients → api), the API key or OAuth connection behind it and that
 * key's daily spending limit (Studio sessions have none), plus the price the caller showed (price guarantee).
 */
export function startOptions(account: Account, req: Request, body: { maxCredits?: unknown }) {
  const origin = account.via === "session" ? ("web" as const) : req.headers.get("x-tachyon-client") === "cli" ? ("cli" as const) : ("api" as const);
  const maxCredits = typeof body.maxCredits === "number" && Number.isFinite(body.maxCredits) ? body.maxCredits : undefined;
  return {
    origin,
    ...(account.keyId ? { apiKeyId: account.keyId } : {}),
    ...(account.via !== "session" && typeof account.dailyLimit === "number" ? { keyLimit: { credits: account.dailyLimit, windowMs: DAY_MS } } : {}),
    ...(maxCredits !== undefined ? { maxCredits } : {}),
  };
}
