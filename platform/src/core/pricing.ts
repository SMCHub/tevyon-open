/**
 * The cost model of the open version: every model is bought through the Comfy Router, which lists its prices in Comfy
 * credits (docs.comfy.org, «Partner Nodes pricing»). A job's credits = its Comfy credits × CREDIT_MARKUP, rounded UP to
 * a whole credit. With the default markup of 1 a Tevyon credit is a Comfy credit: the platform passes the price on.
 * An operator who sells credits sets CREDIT_MARKUP (e.g. 1.3) and the packs below.
 */
const markup = (): number => {
  const raw = Number(globalThis.process?.env?.CREDIT_MARKUP);
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
};

/** Credits for a job that costs `comfyCredits` at the router. Never 0 for a paid job. */
export function creditsFromComfy(comfyCredits: number): number {
  // toFixed removes float dust (12.37 × 1 = 12.370000000000001) before rounding up.
  const raw = Number((comfyCredits * markup()).toFixed(6));
  return raw <= 0 ? 0 : Math.max(1, Math.ceil(raw));
}

export type CreditPack = { id: "start" | "plus" | "pro" | "studio"; credits: number; /** CHF incl. VAT */ priceChf: number };

/** One-time packs (Stripe, optional). Bought credits never expire. Example prices: set your own. */
export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "start", credits: 1_000, priceChf: 10 },
  { id: "plus", credits: 3_000, priceChf: 27 },
  { id: "pro", credits: 7_500, priceChf: 60 },
  { id: "studio", credits: 20_000, priceChf: 140 },
];

export type PlanId = "monat-2000" | "monat-5000" | "monat-12000" | "monat-25000";
export type Plan = { id: PlanId; /** per month */ credits: number; /** CHF incl. VAT per month */ priceChf: number };

/**
 * Monthly plans (Stripe, optional). Plan credits expire with their month and are spent first; packs top up on the side.
 * Plan ids are Stripe lookup_keys and rows in `subscriptions`: never rename or delete one, only add new ones.
 */
export const PLANS: readonly Plan[] = [
  { id: "monat-2000", credits: 2_000, priceChf: 18 },
  { id: "monat-5000", credits: 5_000, priceChf: 42 },
  { id: "monat-12000", credits: 12_000, priceChf: 90 },
  { id: "monat-25000", credits: 25_000, priceChf: 175 },
];
