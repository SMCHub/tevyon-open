import type { JsonSchema, Model } from "./api.ts";

/**
 * Model parameters come from each model's JSON Schema in /api/catalog: --aspect-ratio 16:9 becomes
 * { aspect_ratio: "16:9" }, numbers and booleans are typed by the schema. The server validates the rest.
 */
export type ValueType = "string" | "number" | "integer" | "boolean";

const BOOL: Record<string, boolean> = { true: true, false: false, yes: true, no: false, ja: true, nein: false, "1": true, "0": false };

export const flagName = (param: string) => param.replaceAll("_", "-");
export const paramName = (flag: string) => flag.replaceAll("-", "_");

export function valueType(schema: JsonSchema): ValueType {
  const types = new Set<string>();
  const typeOf = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v);
  const visit = (s: JsonSchema) => {
    if (typeof s.type === "string") types.add(s.type);
    if (Array.isArray(s.type)) for (const t of s.type) types.add(t);
    if (s.const !== undefined) types.add(typeOf(s.const));
    for (const v of s.enum ?? []) types.add(typeOf(v));
    for (const sub of [...(s.anyOf ?? []), ...(s.oneOf ?? [])]) visit(sub);
  };
  visit(schema);
  if (types.has("boolean")) return "boolean";
  if (types.has("string")) return "string";
  if (types.has("number")) return "number";
  if (types.has("integer")) return "integer";
  return "string";
}

/** Flags that are booleans in any model. They never take the next word as their value. */
export function booleanFlags(models: Model[]): Set<string> {
  const out = new Set<string>();
  for (const m of models) {
    for (const [name, s] of Object.entries(m.params.properties ?? {})) if (valueType(s) === "boolean") out.add(flagName(name));
  }
  return out;
}

/** Parameters that take one of the account's uploads (start image …): their schema points at /api/media/uploads. */
export function uploadParams(model: Model): string[] {
  return Object.entries(model.params.properties ?? {})
    .filter(([, s]) => typeof (s as { pattern?: unknown }).pattern === "string" && /media\\?\/uploads/.test((s as { pattern: string }).pattern))
    .map(([name]) => name);
}

export const UPLOAD_PATH = /^\/api\/media\/uploads\//;

/** The model's parameters as flags, without prompt: for help and error texts. */
export function paramFlags(model: Model): string[] {
  return Object.keys(model.params.properties ?? {}).filter((p) => p !== "prompt").map(flagName);
}

export type BuildResult =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; error: "unknown_param"; name: string; allowed: string[] }
  | { ok: false; error: "bad_value"; name: string; value: string; want: Exclude<ValueType, "string"> };

export function buildParams(model: Model, flags: Map<string, string | boolean>, prompt: string | undefined): BuildResult {
  const props = model.params.properties ?? {};
  const params: Record<string, unknown> = prompt === undefined ? {} : { prompt };
  for (const [flag, raw] of flags) {
    const name = paramName(flag);
    const schema = props[name];
    if (!schema || name === "prompt") return { ok: false, error: "unknown_param", name: flag, allowed: paramFlags(model) };
    const type = valueType(schema);
    const text = String(raw);
    if (type === "boolean") {
      const b = typeof raw === "boolean" ? raw : BOOL[text.toLowerCase()];
      if (b === undefined) return { ok: false, error: "bad_value", name: flag, value: text, want: "boolean" };
      params[name] = b;
    } else if (type === "number" || type === "integer") {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (!Number.isFinite(n) || (type === "integer" && !Number.isInteger(n))) return { ok: false, error: "bad_value", name: flag, value: text, want: type };
      params[name] = n;
    } else {
      params[name] = text;
    }
  }
  return { ok: true, params };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Finds a model by job type, by model name ("FLUX 3", "flux-3") or by a unique beginning ("veo"). */
export function resolveModel(models: Model[], name: string): { model: Model } | { error: "unknown" } | { error: "ambiguous"; options: Model[] } {
  const exact = models.find((m) => m.jobType === name);
  if (exact) return { model: exact };
  const n = norm(name);
  if (!n) return { error: "unknown" };
  const same = models.filter((m) => norm(m.jobType) === n || norm(m.model) === n);
  if (same.length === 1) return { model: same[0]! };
  const starts = models.filter((m) => norm(m.jobType).startsWith(n) || norm(m.model).startsWith(n));
  if (starts.length === 1) return { model: starts[0]! };
  return starts.length > 1 ? { error: "ambiguous", options: starts } : { error: "unknown" };
}
