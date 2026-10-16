/** Helpers to render register parameters (JSON schema from /api/catalog) as UI controls. */
export type JsonSchema = {
  type?: string;
  enum?: (string | number)[];
  anyOf?: { const?: string | number }[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  properties?: Record<string, JsonSchema>;
};

export type Value = string | number | boolean;

export const PARAM_LABEL: Record<string, string> = {
  aspect_ratio: "Format",
  resolution: "Auflösung",
  duration: "Dauer",
  generate_audio: "Ton",
  mode: "Modus",
  quality: "Qualität",
  scale: "Vergrösserung",
};

/** Words for option values that are codes (recast's mode). */
const VALUE_LABEL: Record<string, Record<string, string>> = {
  mode: { motion: "Bewegung übertragen", replace: "Objekt tauschen" },
  quality: { low: "Entwurf", medium: "Mittel", high: "Hoch", xhigh: "Sehr hoch", max: "Maximal" },
};

/** Selectable values of one parameter, or null for free input (e.g. the prompt). Durations up to 30 s are whole seconds. */
export function choices(s: JsonSchema): Value[] | null {
  if (s.enum) return s.enum;
  if (s.anyOf?.every((a) => a.const !== undefined)) return s.anyOf.map((a) => a.const!);
  if (s.type === "boolean") return [true, false];
  if (s.type === "integer" && s.minimum !== undefined && s.maximum !== undefined && s.maximum - s.minimum <= 30) {
    return Array.from({ length: s.maximum - s.minimum + 1 }, (_, i) => s.minimum! + i);
  }
  return null;
}

/** «480p» → 480, «2K» → 2000, «4K» → 4000: only to rank resolutions, so 2K sits above 1080p. */
function resolutionRank(v: string): number {
  const p = /^(\d+)p?$/i.exec(v);
  if (p) return Number(p[1]);
  const k = /^(\d+(?:\.\d+)?)k$/i.exec(v);
  return k ? Number(k[1]) * 1000 : 0;
}

/** What a model can do, read from its parameters only: highest resolution, shortest and longest clip, sound switch. */
export function modelSpec(schema: JsonSchema): { resolution: string | null; seconds: { min: number; max: number } | null; sound: boolean } {
  const props = schema.properties ?? {};
  const resolutions = props.resolution ? choices(props.resolution) : null;
  const durations = props.duration ? (choices(props.duration) as number[] | null) : null;
  return {
    resolution: resolutions?.length ? String([...resolutions].sort((a, b) => resolutionRank(String(b)) - resolutionRank(String(a)))[0]) : null,
    seconds: durations?.length ? { min: Math.min(...durations), max: Math.max(...durations) } : null,
    sound: Boolean(props.generate_audio),
  };
}

/**
 * What the model list shows about a model: the highest resolution, the duration span and «Ton» when sound can be
 * switched on. Never a guess: a model that does not list it gets no fact.
 */
export function modelFacts(schema: JsonSchema): string[] {
  const { resolution, seconds, sound } = modelSpec(schema);
  const facts: string[] = [];
  if (resolution) facts.push(resolution);
  if (seconds) facts.push(seconds.min === seconds.max ? `${seconds.max} s` : `${seconds.min}–${seconds.max} s`);
  if (sound) facts.push("Ton");
  return facts;
}

export function showValue(key: string, v: unknown): string {
  if (typeof v === "boolean") return v ? "Mit Ton" : "Ohne Ton";
  if (key === "duration") return `${v} s`;
  return VALUE_LABEL[key]?.[String(v)] ?? String(v);
}

export function defaults(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(schema.properties ?? {})) if (s.default !== undefined) out[k] = s.default;
  return out;
}

/** Options of a model, without the prompt. */
export function optionKeys(schema: JsonSchema): string[] {
  return Object.entries(schema.properties ?? {})
    .filter(([k, s]) => k !== "prompt" && choices(s))
    .map(([k]) => k);
}

/** "16:9" → 16/9 for placeholders; defaults to square. */
export function ratio(aspect: unknown): number {
  const m = typeof aspect === "string" ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect) : null;
  return m ? Number(m[1]) / Number(m[2]) : 1;
}
