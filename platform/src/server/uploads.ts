import { acceptUpload, allowAllScanner, type AcceptResult, type UploadScanner } from "@/core/upload-scan";
import { rateLimiter } from "./rate-limits";
import { runtime } from "./runtime";
import { comfyKey } from "./comfy";
import { createChatUploadScanner } from "./upload-scanner";

// Outside the runtime object, so a dev server that hot-reloads keeps working without a restart.
const g = globalThis as unknown as { __tachyonUploadScanner?: UploadScanner };

/** The scan service: a vision model through the Comfy Router (model: UPLOAD_SCAN_MODEL), without a key everything passes (demo). */
function scanner(): UploadScanner {
  if (g.__tachyonUploadScanner) return g.__tachyonUploadScanner;
  const key = comfyKey();
  if (!key) console.warn("[upload-scan] no COMFY_API_KEY: uploads are stored unscanned (demo mode)");
  return (g.__tachyonUploadScanner = key ? createChatUploadScanner({ apiKey: key, model: process.env.UPLOAD_SCAN_MODEL }) : allowAllScanner);
}

/** Checks, scans and stores an outside file as the account's upload (core/upload-scan.ts). Every ingest route uses this. */
/** Paid upload scans per account and 24 hours, over every upload route together. */
export const UPLOAD_SCAN_LIMIT = { limit: 200, windowMs: 86_400_000 };

export async function acceptAccountUpload(accountId: string, data: Uint8Array): Promise<AcceptResult> {
  const rt = await runtime();
  const allow = async (id: string) => (await rateLimiter().hit(`uploads:acc:${id}`, UPLOAD_SCAN_LIMIT)).ok;
  return acceptUpload({ scanner: scanner(), media: rt.media, log: (m) => console.warn(m), allow }, accountId, data);
}

/** The JSON answer of an upload route for a refused file. Own codes only, no vendor text. */
export function refusal(res: Exclude<AcceptResult, { ok: true }>): Response {
  return Response.json({ ok: false, error: res.error, ...("category" in res ? { category: res.category } : {}) }, { status: res.status });
}
