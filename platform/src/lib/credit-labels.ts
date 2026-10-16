import type { CreditEntry, GrantSource, JobCharge, ReversalSource } from "@/core/credits";
import type { JobOrigin } from "@/core/repository";

/** Wording for credit movements, shared by the Studio and the CSV export. */
export const GRANT_LABEL: Record<GrantSource, string> = {
  welcome: "Willkommens-Credits",
  purchase: "Aufladung",
  subscription: "Abo-Credits",
  adjustment: "Gutschrift",
};

export const REVERSAL_LABEL: Record<ReversalSource, string> = {
  refund: "Rückerstattung",
  dispute: "Zahlungsstreit",
  dispute_won: "Zahlungsstreit beigelegt",
};

export const CHARGE_LABEL: Record<JobCharge, string> = {
  reserved: "reserviert",
  charged: "abgebucht",
  refunded: "zurückerstattet",
};

export const ORIGIN_LABEL: Record<JobOrigin, string> = {
  web: "Studio",
  mcp: "MCP",
  cli: "CLI",
  api: "API",
};

export function entryTitle(e: CreditEntry): string {
  if (e.kind === "grant") return GRANT_LABEL[e.source];
  if (e.kind === "reversal") return REVERSAL_LABEL[e.source];
  if (e.kind === "director") return `Director · ${e.model}`;
  if (e.kind === "expiry") return "Abo-Credits verfallen";
  return e.model;
}

/** Kind of a line for lists and the CSV: Gutschrift, Job, Director, Rückbuchung, Verfall. */
export function entryKindLabel(e: CreditEntry): string {
  return { grant: "Gutschrift", job: "Job", director: "Director", reversal: "Rückbuchung", expiry: "Verfall" }[e.kind];
}

/** "+100", "−64", "0": the change as people write it, with a real minus sign. */
export function signed(n: number): string {
  if (n > 0) return `+${n.toLocaleString("de-CH")}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString("de-CH")}`;
  return "0";
}
