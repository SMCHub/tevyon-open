import { z } from "zod";
import type { JobTypeDef } from "./register";

/** An upload URL that passes the start-image check, so image-to-video can be priced and compared. */
export const SAMPLE_UPLOAD = "/api/media/uploads/00000000-0000-4000-8000-000000000000/sample.png";
/** A reference video upload of the given length, 1280×720 (the server names videos "<id>-<w>x<h>_<seconds>s.mp4"). */
export const sampleVideo = (seconds: number) => `/api/media/uploads/00000000-0000-4000-8000-000000000000/sample-1280x720_${seconds}s.mp4`;

type JsonProp = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonProp[];
  oneOf?: JsonProp[];
  minimum?: number;
  maximum?: number;
  maxItems?: number;
};

function optionsOf(key: string, prop: JsonProp): unknown[] | undefined {
  if (prop.enum) return prop.enum;
  if (prop.const !== undefined) return [prop.const];
  const union = prop.anyOf ?? prop.oneOf;
  if (union?.every((p) => p.const !== undefined)) return union.map((p) => p.const);
  if (prop.type === "integer" && prop.minimum !== undefined && prop.maximum !== undefined && prop.maximum - prop.minimum <= 120) {
    return Array.from({ length: prop.maximum - prop.minimum + 1 }, (_, i) => prop.minimum! + i);
  }
  if (prop.type === "boolean") return [true, false];
  if (key === "image" && prop.type === "string") return [undefined, SAMPLE_UPLOAD];
  // Reference video: a typical length first (standard), then both ends of the 4–30 s range.
  if (key === "video" && prop.type === "string") return [sampleVideo(10), sampleVideo(4), sampleVideo(30)];
  // Reference images: none, one and the most the model takes, so prices are checked at both ends.
  if (key === "references" && prop.type === "array" && prop.maxItems) return [[], [SAMPLE_UPLOAD], Array(prop.maxItems).fill(SAMPLE_UPLOAD)];
  return undefined;
}

/**
 * The finite options a job type offers per parameter, read from the JSON schema the studio renders (prompt excluded).
 * The price list and the tests price every combination.
 */
export function offeredOptions(def: JobTypeDef): Record<string, unknown[]> {
  const schema = z.toJSONSchema(def.params, { io: "input" }) as { properties?: Record<string, JsonProp> };
  const out: Record<string, unknown[]> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (key === "prompt") continue;
    const options = optionsOf(key, prop);
    if (options) out[key] = options;
  }
  return out;
}

/**
 * Every valid parameter set: the cartesian product of the offered options, each parsed by the job type's own schema.
 * Inputs without options (a swap's face or person, its consent) come from the job type's sample files.
 */
export function paramSpace(def: JobTypeDef, limit = 5000): Record<string, unknown>[] {
  let combos: Record<string, unknown>[] = [{ prompt: "x", ...def.sample }];
  for (const [key, options] of Object.entries(offeredOptions(def))) {
    combos = combos.flatMap((c) => options.map((o) => (o === undefined ? c : { ...c, [key]: o })));
    if (combos.length > limit) throw new Error(`${def.jobType}: more than ${limit} parameter sets`);
  }
  const seen = new Set<string>();
  const valid: Record<string, unknown>[] = [];
  for (const c of combos) {
    const parsed = def.params.safeParse(c);
    if (!parsed.success) continue;
    const key = JSON.stringify(parsed.data);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(parsed.data as Record<string, unknown>);
  }
  return valid;
}

/**
 * The standard settings of a job type: its defaults with a prompt, plus its sample files for inputs that cannot have a
 * default. The price list reads these.
 */
export function standardParams(def: JobTypeDef): Record<string, unknown> {
  return def.params.parse({ prompt: "x", ...def.sample }) as Record<string, unknown>;
}
