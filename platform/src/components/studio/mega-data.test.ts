import { describe, expect, it } from "vitest";
import { kindTools, megaPlacement, menuFamilies, menuStep, posterLines, priceText, splitTagline, stampLines } from "./mega-data";

type Entry = { jobType: string; kind: "image" | "video"; model: string; tagline: string; badge: "neu" | "top" | null; family?: string; status?: "active" | "deprecated" | "paused" };
const entry = (jobType: string, model: string, family: string | undefined, tagline: string, kind: "image" | "video" = "video", badge: "neu" | "top" | null = null): Entry =>
  ({ jobType, kind, model, tagline, badge, ...(family ? { family } : {}) });

describe("menu families", () => {
  const catalog = [
    entry("flux_3_image", "Seedream 4.5", "seedream", "ByteDance · photorealistic, 4K", "image", "top"),
    entry("veo_3_1_lite", "Veo 3.1 Lite", "veo", "Google · with sound, up to 1080p", "video", "top"),
    entry("flux_2_pro", "FLUX.2 Pro", "flux", "Black Forest Labs · fine details", "image"),
    entry("seedream_5_lite", "Seedream 5 Lite", "seedream", "ByteDance · fast, affordable", "image"),
    entry("flux_3_image", "FLUX.3", "flux", "Black Forest Labs · up to 4K", "image", "neu"),
  ];

  it("groups the models of one kind by family, in the order the register lists them", () => {
    const groups = menuFamilies(catalog, "image");
    expect(groups.map((g) => g.name)).toEqual(["Seedream", "FLUX"]);
    expect(groups[0]!.models.map((m) => m.jobType)).toEqual(["flux_3_image", "seedream_5_lite"]);
    expect(groups[1]!.models.map((m) => m.jobType)).toEqual(["flux_2_pro", "flux_3_image"]);
  });

  it("names a family after its first model and its maker after the taglines, so a new family needs no code", () => {
    const [seedream, flux] = menuFamilies(catalog, "image");
    expect(seedream).toMatchObject({ name: "Seedream", maker: "ByteDance" });
    expect(flux).toMatchObject({ name: "FLUX", maker: "Black Forest Labs" });
  });

  it("keeps a family's name of several words and drops versions and tiers ('GPT Image 2.5' → 'GPT Image')", () => {
    const groups = menuFamilies([
      entry("gpt_image_2_5_sunburst", "GPT Image 2.5", "gpt-image", "OpenAI · precise", "image"),
      entry("gpt_image_2_5_flare", "GPT Image 2.5 Flare", "gpt-image", "OpenAI · faster", "image"),
      entry("nano_banana_pro", "Nano Banana Pro", "nano-banana", "Google · editing", "image"),
      entry("mai_image_2_6", "MAI-Image 2.6", "mai-image", "Microsoft · photorealistic", "image"),
      entry("minimax_h3", "MiniMax H3", "minimax", "MiniMax · a", "image"),
    ], "image");
    expect(groups.map((g) => g.name)).toEqual(["GPT Image", "Nano Banana", "MAI-Image", "MiniMax"]);
  });

  it("lists only the models of the menu's kind", () => {
    expect(menuFamilies(catalog, "video").flatMap((g) => g.models.map((m) => m.jobType))).toEqual(["veo_3_1_lite"]);
  });

  it("lists a model name once, the first job type with that name is its link", () => {
    const groups = menuFamilies([entry("veo_3_1", "Veo 3.1", "veo", "Google · a"), entry("veo_3_1_eu", "Veo 3.1", "veo", "Google · b")], "video");
    expect(groups[0]!.models.map((m) => m.jobType)).toEqual(["veo_3_1"]);
  });

  it("gives a model without family a group of its own and drops a maker the models do not share", () => {
    const groups = menuFamilies([
      entry("a_1", "Alpha 1", undefined, "Maker A · one"),
      entry("b_1", "Beta 1", "beta", "Maker B · one"),
      entry("b_2", "Beta 2", "beta", "Maker C · two"),
    ], "video");
    expect(groups.map((g) => [g.name, g.maker])).toEqual([["Alpha", "Maker A"], ["Beta", null]]);
  });
});

describe("tools of a menu", () => {
  it("lists the fixed tools of each kind, every one a link into the studio", () => {
    expect(kindTools("image").map((t) => t.title)).toEqual(["Create image", "Director", "Image → Video", "My images"]);
    expect(kindTools("video").map((t) => t.href)).toEqual(["/video", "/video?mode=image", "/director"]);
  });
});

describe("tagline", () => {
  it("splits the maker off the description", () => {
    expect(splitTagline("ByteDance · photorealistic, 4K")).toEqual({ maker: "ByteDance", text: "photorealistic, 4K" });
  });

  it("keeps a tagline without maker whole", () => {
    expect(splitTagline("Your video: transfer motion")).toEqual({ maker: null, text: "Your video: transfer motion" });
  });
});

describe("price text", () => {
  it("says \"from\" when settings make it cheaper than the default", () => {
    expect(priceText({ from: 30, standard: 85 })).toBe("from 30 Credits");
  });

  it("gives one price when every setting costs the same", () => {
    expect(priceText({ from: 10, standard: 10 })).toBe("10 Credits");
  });

  it("drops the unit in the menu rows, where the column says \"Credits\"", () => {
    expect(priceText({ from: 30, standard: 85 }, { short: true })).toBe("from 30");
    expect(priceText({ from: 10, standard: 10 }, { short: true })).toBe("10");
  });

  it("formats thousands with a comma and stays empty without a price", () => {
    expect(priceText({ from: 1200, standard: 1500 })).toBe("from 1,200 Credits");
    expect(priceText(undefined)).toBeNull();
  });
});

describe("poster lines", () => {
  it("puts the first word on its own line and the rest under it", () => {
    expect(posterLines("Seedream 4.5")).toEqual(["Seedream", "4.5"]);
    expect(posterLines("Veo 3.1 Lite")).toEqual(["Veo", "3.1 Lite"]);
    expect(posterLines("Image → Video")).toEqual(["Image", "→ Video"]);
  });

  it("keeps a single word on one line", () => {
    expect(posterLines("Recast")).toEqual(["Recast"]);
    expect(posterLines("  Director ")).toEqual(["Director"]);
  });
});

describe("menu step", () => {
  it("tells the direction from one menu to the next, in the order of the header", () => {
    expect(menuStep("image", "video")).toBe(1);
    expect(menuStep("video", "image")).toBe(-1);
    expect(menuStep(null, "video")).toBe(0);
    expect(menuStep("video", "video")).toBe(0);
  });
});

describe("placement", () => {
  it("lies flush under a full-width bar, over the whole width", () => {
    expect(megaPlacement({ left: 0, width: 1512, bottom: 72 }, 1512)).toEqual({ mode: "flush", top: 72, left: 0, width: 1512 });
  });

  it("floats as a card 8 px under a pill, as wide as the pill", () => {
    expect(megaPlacement({ left: 196, width: 1120, bottom: 63 }, 1512)).toEqual({ mode: "float", top: 71, left: 196, width: 1120 });
  });

  it("gives a narrow pill a card wide enough for three columns, centred under it and inside the screen", () => {
    expect(megaPlacement({ left: 400, width: 600, bottom: 63 }, 1400)).toEqual({ mode: "float", top: 71, left: 220, width: 960 });
    expect(megaPlacement({ left: 0, width: 600, bottom: 63 }, 1000)).toEqual({ mode: "float", top: 71, left: 12, width: 960 });
    expect(megaPlacement({ left: 100, width: 600, bottom: 63 }, 900)).toEqual({ mode: "float", top: 71, left: 12, width: 876 });
  });
});

describe("stamp", () => {
  it("breaks a description at the comma nearest its middle", () => {
    expect(stampLines("From text in seconds, price before you start")).toEqual(["From text in seconds,", "price before you start"]);
    expect(stampLines("photorealistic, 4K")).toEqual(["photorealistic,", "4K"]);
    expect(stampLines("One photo, a finished clip, one click")).toEqual(["One photo, a finished clip,", "one click"]);
  });

  it("breaks between words otherwise, and leaves one word alone", () => {
    expect(stampLines("fine details")).toEqual(["fine", "details"]);
    expect(stampLines("Plan the scene and render the final")).toEqual(["Plan the scene", "and render the final"]);
    expect(stampLines("Versatile")).toEqual(["Versatile"]);
  });
});
