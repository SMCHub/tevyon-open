import { z } from "zod";

/**
 * The register: one entry per job type. Everything a job needs to know about a model lives here,
 * including the credit formula. The route is server-only and never leaves the core.
 */
export type JobTypeDef<S extends z.ZodType = z.ZodType> = {
  jobType: string;
  kind: "image" | "video";
  /** Public model name, e.g. "Seedance 2.0". */
  model: string;
  /** One line for the model menu: maker and strengths. Never the purchase route. */
  tagline: string;
  badge?: "neu" | "top";
  params: S;
  credits: (params: z.output<S>) => number;
  /** Model family ("veo", "kling" …): groups versions of one maker's model. */
  family?: string;
  route: { provider: string; providerModel: string };
  /**
   * The vendor id for these params, where one model has an id per input (Wan 2.7 and HappyHorse on the Comfy Router:
   * text alone, or a start image). Default: route.providerModel. Same provider; the job's handle carries the id it went to.
   */
  routeFor?: (params: z.output<S>) => string;
  /** Every id routeFor can pick, so tools (router schemas, contract test) know them without enumerating params. */
  routes?: string[];
  /**
   * What the vendor gets, from the stored params (with the written prompt). Default: the params as they are. Maps our
   * parameter names to the model's own request shape and drops fields that are ours only.
   */
  vendorParams?: (params: z.output<S>) => Record<string, unknown>;
  /** Sample inputs for required files without a default (param-space.ts standardParams): prices the standard settings. */
  sample?: Record<string, unknown>;
  /**
   * The pictures of real people the job shows (Face Swap, Character Swap). Started over the API, MCP or the CLI, such a
   * job needs a consent a person confirmed in Tevyon for exactly these pictures (core/consent.ts); in the Studio the
   * person ticks the box themselves.
   */
  consentImages?: (params: z.output<S>) => string[];
};

export type Register = {
  get(jobType: string): JobTypeDef | undefined;
  list(): JobTypeDef[];
};

/** Identity helper so each entry's credit formula is typed against its own params schema. */
export function jobType<S extends z.ZodType>(def: JobTypeDef<S>): JobTypeDef {
  return def as unknown as JobTypeDef;
}

export function defineRegister(defs: JobTypeDef[]): Register {
  const byType = new Map(defs.map((d) => [d.jobType, d]));
  return {
    get: (t) => byType.get(t),
    list: () => [...byType.values()],
  };
}

/**
 * A job type's parameters as JSON Schema for agents and the studio. The prompt carries the limit its prompt skill
 * enforces (max_chars; the server cuts a longer prompt after the last whole sentence), never more than the schema
 * itself accepts.
 */
export function publicParams(def: JobTypeDef, promptMax?: number) {
  const schema = z.toJSONSchema(def.params, { io: "input" });
  const prompt = (schema as { properties?: Record<string, { maxLength?: number }> }).properties?.prompt;
  if (prompt && promptMax !== undefined) prompt.maxLength = Math.min(prompt.maxLength ?? promptMax, promptMax);
  return schema;
}
