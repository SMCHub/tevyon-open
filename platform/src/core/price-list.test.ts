import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { priceList } from "./price-list";

describe("price list", () => {
  it("lists every model with its cheapest price and the price at its standard settings", () => {
    const list = priceList(catalog);
    expect(list.map((p) => p.jobType)).toEqual(catalog.list().map((d) => d.jobType));
    for (const p of list) {
      expect(p.from, p.jobType).toBeGreaterThan(0);
      expect(p.from, p.jobType).toBeLessThanOrEqual(p.standard);
    }
    // Veo 3.1 Lite: 4 s at 720p without sound = 25.32 → 26; standard 8 s at 720p with sound = 84.4 → 85.
    expect(list.find((p) => p.jobType === "veo_3_1_lite")).toMatchObject({ model: "Veo 3.1 Lite", kind: "video", from: 26, standard: 85 });
  });

  it("shows the standard settings without the prompt or empty inputs, never the route", () => {
    const veo = priceList(catalog).find((p) => p.jobType === "veo_3_1_lite")!;
    expect(veo.settings).toEqual({ duration: 8, resolution: "720p", aspect_ratio: "16:9", generate_audio: true });
    const flux = priceList(catalog).find((p) => p.jobType === "flux_3_image")!;
    expect(flux.settings).toEqual({ aspect_ratio: "1:1", resolution: "1k" });
    expect(JSON.stringify(priceList(catalog))).not.toMatch(/comfy|providerModel|\//);
  });
});
