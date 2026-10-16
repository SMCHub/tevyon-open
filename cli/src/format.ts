/** Plain-text tables and small helpers for human output. No colours: the output is often read by agents too. */
export function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0))).join("  ").trimEnd();
  return [line(head), ...rows.map(line)].join("\n");
}

export function truncate(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export const shortId = (id: string) => id.slice(0, 8);

export function when(ms: number, lang: "de" | "en"): string {
  return new Date(ms).toLocaleString(lang === "de" ? "de-CH" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** A day with its year, e.g. 15.11.2026 (until when plan credits run). */
export function day(ms: number, lang: "de" | "en"): string {
  return new Date(ms).toLocaleDateString(lang === "de" ? "de-CH" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "image/svg+xml": "svg" };

/** File name for an output: model, short job id and number, e.g. flux-3-423b7894-2.png. */
export function outputName(model: string, jobId: string, index: number, count: number, contentType: string): string {
  const slug = model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tevyon";
  const ext = EXT[contentType.split(";")[0]?.trim() ?? ""] ?? "bin";
  return `${slug}-${shortId(jobId)}${count > 1 ? `-${index + 1}` : ""}.${ext}`;
}
