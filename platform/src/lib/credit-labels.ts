import type { CreditEntry, GrantSource, JobCharge, ReversalSource } from "@/core/credits";
import type { JobOrigin } from "@/core/repository";

/** Wording for credit movements, shared by the Studio and the CSV export. */
export const GRANT_LABEL: Record<GrantSource, string> = {
  welcome: "Welcome Credits",
  purchase: "Top-up",
  subscription: "Plan Credits",
  adjustment: "Credit added",
};

export const REVERSAL_LABEL: Record<ReversalSource, string> = {
  refund: "Refund",
  dispute: "Payment dispute",
  dispute_won: "Payment dispute resolved",
};

export const CHARGE_LABEL: Record<JobCharge, string> = {
  reserved: "reserved",
  charged: "charged",
  refunded: "refunded",
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
  if (e.kind === "expiry") return "Plan Credits expired";
  return e.model;
}

/** Kind of a line for lists and the CSV: Credit, Job, Director, Reversal, Expiry. */
export function entryKindLabel(e: CreditEntry): string {
  return { grant: "Credit", job: "Job", director: "Director", reversal: "Reversal", expiry: "Expiry" }[e.kind];
}

/** "+100", "−64", "0": the change as people write it, with a real minus sign. */
export function signed(n: number): string {
  if (n > 0) return `+${n.toLocaleString("en-US")}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString("en-US")}`;
  return "0";
}
