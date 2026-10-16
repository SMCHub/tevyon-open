"use client";

import { useEffect, useState } from "react";

/** What a model costs at least (`from`) and at its standard settings, in credits, from /api/prices. */
export type Price = { from: number; standard: number };

let priceCache: Map<string, Price> | null = null;
let priceLoad: Promise<void> | null = null;

/** /api/prices once per session (public, cached for five minutes): what each model costs at least, by job type. */
export function usePrices(): Map<string, Price> | null {
  const [prices, setPrices] = useState(priceCache);
  useEffect(() => {
    if (priceCache) return;
    let live = true;
    priceLoad ??= fetch("/api/prices")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`prices ${r.status}`))))
      .then((d: { prices?: { jobType: string; from: unknown; standard: unknown }[] }) => {
        const ok = (d.prices ?? []).filter((p): p is { jobType: string; from: number; standard: number } => typeof p.from === "number" && typeof p.standard === "number");
        priceCache = new Map(ok.map((p) => [p.jobType, { from: p.from, standard: p.standard }]));
      })
      .catch(() => {
        priceLoad = null;
      });
    void priceLoad.then(() => live && setPrices(priceCache));
    return () => {
      live = false;
    };
  }, []);
  return prices;
}
