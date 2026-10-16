import { createHash } from "node:crypto";
import type { MediaStore } from "./media";
import { checkUpload } from "./uploads";

/**
 * Every upload is scanned before it is stored.
 * The categories follow the usage rules (landing «Nutzungsrichtlinien»): sexual content with minors, explicit nudity,
 * glorified real violence and gore, terror or hate propaganda, identity and official documents. Real people as such are
 * allowed (the consent box covers them); the scan never says who someone is (no biometric identification, privacy policy).
 */
export type ScanCategory = "minors" | "nudity" | "violence" | "extremism" | "documents" | "other";
export const SCAN_CATEGORIES: ScanCategory[] = ["minors", "nudity", "violence", "extremism", "documents", "other"];
export type ScanVerdict = { allowed: true } | { allowed: false; category: ScanCategory };

export interface UploadScanner {
  scan(file: { data: Uint8Array; contentType: string }, signal?: AbortSignal): Promise<ScanVerdict>;
}

/** How long a scan may take (measured 15.10.2026: 2–7 s per image, up to 15 s per short clip). */
export const SCAN_TIMEOUT_MS = { image: 30_000, video: 60_000 };

export type AcceptResult =
  | { ok: true; url: string }
  | { ok: false; status: 413 | 415; error: "too_large" | "unreadable_video" | "not_an_image" }
  | { ok: false; status: 422; error: "upload_blocked"; category: ScanCategory }
  | { ok: false; status: 429; error: "upload_limit" }
  | { ok: false; status: 503; error: "scan_unavailable" };

/**
 * The one way an outside file becomes an upload (browser, signed agent links, MCP, product pages): bytes checked, then
 * scanned, then stored. A blocked file is never stored; a scan that cannot run refuses the upload (fail closed).
 * The key is the file's content hash, so the same file uploaded again is the same upload, not a new copy, and an
 * address never gets other bytes (a consent confirmed for a picture stays bound to exactly that picture).
 */
export async function acceptUpload(
  deps: {
    scanner: UploadScanner; media: MediaStore; log?: (m: string) => void; timeoutMs?: { image: number; video: number };
    /** Counts one paid scan for the account; false once its daily share is used (server: UPLOAD_SCAN_LIMIT). */
    allow?: (accountId: string) => Promise<boolean>;
  },
  accountId: string,
  data: Uint8Array,
): Promise<AcceptResult> {
  const check = checkUpload(data);
  if (!check.ok) return check;
  // Before the scan: every scan costs money at the vendor, so an account (or a leaked signed link) cannot run up costs.
  if (deps.allow && !(await deps.allow(accountId))) return { ok: false, status: 429, error: "upload_limit" };
  let verdict: ScanVerdict;
  try {
    // A hanging scan must not hold the upload open: past its limit it counts as unavailable (fail closed).
    const limits = deps.timeoutMs ?? SCAN_TIMEOUT_MS;
    const signal = AbortSignal.timeout(check.contentType.startsWith("video/") ? limits.video : limits.image);
    verdict = await deps.scanner.scan({ data, contentType: check.contentType }, signal);
  } catch (e) {
    deps.log?.(`[upload-scan] ${accountId} ${check.contentType} scan failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, status: 503, error: "scan_unavailable" };
  }
  if (!verdict.allowed) {
    deps.log?.(`[upload-scan] ${accountId} ${check.contentType} blocked: ${verdict.category}`);
    return { ok: false, status: 422, error: "upload_blocked", category: verdict.category };
  }
  const name = createHash("sha256").update(data).digest("hex");
  return { ok: true, url: await deps.media.put(`uploads/${accountId}/${name}${check.suffix}`, data, check.contentType) };
}

/** Lets everything through. Only where no scan service is configured (tests, local runs without a vendor key). */
export const allowAllScanner: UploadScanner = { scan: async () => ({ allowed: true }) };
