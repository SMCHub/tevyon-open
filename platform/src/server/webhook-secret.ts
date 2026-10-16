import { createHmac } from "node:crypto";

/**
 * The account's webhook secret (core/webhooks.ts): derived from the server secret with its own purpose prefix, never
 * stored, the same on every server. Shown in the «API & MCP» console and by MCP get_account. Undefined without
 * MEDIA_LINK_SECRET: then no webhook is accepted.
 */
export function webhookSecret(accountId: string): string | undefined {
  const secret = process.env.MEDIA_LINK_SECRET;
  if (!secret) return undefined;
  return `whsec_${createHmac("sha256", secret).update(`webhook-secret:${accountId}`).digest("base64url")}`;
}
