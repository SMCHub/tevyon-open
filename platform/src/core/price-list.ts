import { paramSpace, standardParams } from "./param-space";
import type { Register } from "./register";

/** One model in the public price list: credits from its cheapest settings and at its standard settings. */
export type PriceEntry = {
  jobType: string;
  model: string;
  kind: "image" | "video";
  from: number;
  standard: number;
  /** The standard settings, without the prompt and empty inputs (what «standard» means). */
  settings: Record<string, unknown>;
};

const empty = (v: unknown) => v === undefined || (Array.isArray(v) && v.length === 0);

/** The public price list (/api/prices, the studio's model menus and the credits page), straight from the register. */
export function priceList(register: Register): PriceEntry[] {
  return register.list().map((def) => {
    const standard = standardParams(def);
    const prices = paramSpace(def).map((p) => def.credits(p));
    const settings = Object.fromEntries(Object.entries(standard).filter(([k, v]) => k !== "prompt" && !empty(v)));
    return {
      jobType: def.jobType, model: def.model, kind: def.kind,
      from: Math.min(...prices), standard: def.credits(standard), settings,
    };
  });
}
