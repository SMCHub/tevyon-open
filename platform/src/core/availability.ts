/**
 * Whether a job type takes new jobs. The runtime decides it (all active by default); jobs.ts checks it before any
 * credit is reserved. Running jobs are never affected.
 * - active: normal.
 * - deprecated: still takes jobs until retiresAt (vendor deprecation date or grace after a successor arrived).
 * - paused: temporarily off, e.g. the vendor's list price is above what the job costs in credits.
 * - retired: off for good (vendor removed it, or its retirement date passed); successor names the replacement.
 */
export type Availability =
  | { ok: true; status: "active" | "deprecated"; retiresAt?: string; successor?: string }
  | { ok: false; reason: "unknown" | "paused" | "retired"; successor?: string };

export const AVAILABLE: Availability = { ok: true, status: "active" };
