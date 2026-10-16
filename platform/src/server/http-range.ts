/**
 * The byte range a request asks for (RFC 9110 §14). Browsers fetch video in ranges, and Safari plays nothing from a
 * server that answers a range request with the whole file. Only a single range is served; for anything else
 * (no header, several ranges, garbage) the whole file is the valid answer.
 */
export function byteRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | undefined {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return undefined;
  if (m[1] === "") {
    const last = Math.min(Number(m[2]), size); // "-500": the last 500 bytes
    return last === 0 ? "unsatisfiable" : { start: size - last, end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return "unsatisfiable";
  if (end < start) return undefined;
  return { start, end };
}
