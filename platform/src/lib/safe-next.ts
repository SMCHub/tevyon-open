/**
 * Where to go after the login (?next=…): a path on this site only. Anything that could leave the site (another host,
 * a scheme, "//host", "/\host") or loop back to the login is ignored. Used by the proxy and the login form.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\\]/.test(raw)) return null;
  try {
    if (new URL(raw, "https://tachyon.invalid").origin !== "https://tachyon.invalid") return null;
  } catch {
    return null;
  }
  return raw.startsWith("/login") ? null : raw;
}
