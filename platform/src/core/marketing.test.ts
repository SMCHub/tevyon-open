import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import {
  composeMarketingJob,
  composeUgcVideo,
  findStyle,
  flowRules,
  MS_CATEGORIES,
  MS_STYLES,
  MS_TEMPLATES,
  publicTemplates,
  publicStyle,
  styleAvailable,
  type MsInputs,
} from "./marketing";

const PRODUCT = "/api/media/uploads/00000000-0000-4000-8000-000000000001/prod.jpg";
const AVATAR = "/api/media/uploads/00000000-0000-4000-8000-000000000001/face.jpg";
const AD_REF = "/api/media/uploads/00000000-0000-4000-8000-000000000001/adref.png";

const has = (jobType: string) => catalog.get(jobType) !== undefined;
const styleOf = (flow: string) => MS_STYLES.find((s) => s.flow === flow && styleAvailable(s, has))!;

function job(styleId: string, inputs: MsInputs) {
  const res = composeMarketingJob(styleId, inputs, has);
  if (!res.ok) throw new Error(`${styleId}: ${res.error}`);
  return res;
}

describe("marketing agent: catalogue", () => {
  it("has the six categories in their order", () => {
    expect(MS_CATEGORIES.map((c) => c.id)).toEqual(["ugc", "product", "motion", "ads", "posters", "marketplace"]);
  });

  it("gives every category at least four styles with unique ids", () => {
    for (const c of MS_CATEGORIES) expect(MS_STYLES.filter((s) => s.category === c.id).length, c.id).toBeGreaterThanOrEqual(4);
    expect(new Set(MS_STYLES.map((s) => s.id)).size).toBe(MS_STYLES.length);
  });

  it("never shows the prompt to the browser", () => {
    for (const s of MS_STYLES) {
      const pub = publicStyle(s, has) as Record<string, unknown>;
      expect(pub).not.toHaveProperty("prompt");
      expect(JSON.stringify(pub)).not.toContain(s.prompt.slice(0, 40));
    }
  });

  it("each available style composes a job its model accepts, with its default settings", () => {
    for (const s of MS_STYLES.filter((x) => styleAvailable(x, has))) {
      const rules = flowRules(s.flow);
      const res = job(s.id, { product: PRODUCT, ...(rules.avatar !== "none" ? { avatar: AVATAR } : {}), wish: "Sommer-Aktion" });
      // UGC returns its first step (the still) here.
      const parsed = catalog.get(res.jobType)!.params.safeParse(res.params);
      expect(parsed.success, `${s.id}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
  });
});

describe("marketing agent: image flows", () => {
  it("product shot: the product is image 1 and the prompt names it so", () => {
    const s = styleOf("product_shots");
    const res = job(s.id, { product: PRODUCT });
    expect(res.params.references).toEqual([PRODUCT]);
    expect(String(res.params.prompt)).toContain("image 1");
    expect(res.params.aspect_ratio).toBe(s.aspect);
  });

  it("product shot needs a product photo", () => {
    expect(composeMarketingJob(styleOf("product_shots").id, {}, has)).toEqual({ ok: false, error: "product_image_required" });
  });

  it("with model: the avatar becomes image 2; without an avatar the style's own model is described", () => {
    const s = styleOf("product_shots_people");
    const withAvatar = job(s.id, { product: PRODUCT, avatar: AVATAR });
    expect(withAvatar.params.references).toEqual([PRODUCT, AVATAR]);
    expect(String(withAvatar.params.prompt)).toContain("image 2");
    const without = job(s.id, { product: PRODUCT });
    expect(without.params.references).toEqual([PRODUCT]);
    expect(String(without.params.prompt)).not.toContain("image 2");
  });

  it("an avatar is refused where the flow takes none", () => {
    expect(composeMarketingJob(styleOf("product_shots").id, { product: PRODUCT, avatar: AVATAR }, has)).toEqual({ ok: false, error: "avatar_not_supported" });
  });

  it("an ad reference is the last image and the prompt takes only its look from it", () => {
    const s = styleOf("ads");
    const res = job(s.id, { product: PRODUCT, adReference: AD_REF });
    expect(res.params.references).toEqual([PRODUCT, AD_REF]);
    expect(String(res.params.prompt)).toMatch(/image 2/);
  });

  it("takes only the aspect ratios of its flow (ads: 7, product: 8, poster and marketplace: none)", () => {
    expect(flowRules("ads").aspects).toEqual(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"]);
    expect(flowRules("product_shots").aspects).toHaveLength(8);
    expect(flowRules("poster").aspects).toEqual([]);
    expect(flowRules("marketplace").aspects).toEqual([]);
    const ad = styleOf("ads");
    expect(job(ad.id, { product: PRODUCT, aspect: "16:9" }).params.aspect_ratio).toBe("16:9");
    expect(composeMarketingJob(ad.id, { product: PRODUCT, aspect: "21:9" }, has)).toEqual({ ok: false, error: "aspect_ratio_invalid" });
    // A flow without a choice keeps the style's format whatever the client sends.
    const poster = styleOf("poster");
    expect(composeMarketingJob(poster.id, { product: PRODUCT, aspect: "16:9" }, has)).toEqual({ ok: false, error: "aspect_ratio_invalid" });
  });

  it("poster: a product photo or a wish, one of the two is enough", () => {
    const s = styleOf("poster");
    expect(composeMarketingJob(s.id, {}, has)).toEqual({ ok: false, error: "poster_content_required" });
    const fromWish = job(s.id, { wish: "Fresh organic lemonade with ginger" });
    expect(fromWish.params.references).toEqual([]);
    expect(String(fromWish.params.prompt)).toContain("Fresh organic lemonade with ginger");
    expect(job(s.id, { product: PRODUCT }).params.references).toEqual([PRODUCT]);
  });

  it("batch 1 to 4, except posters", () => {
    expect(flowRules("product_shots").batch).toBe(true);
    expect(flowRules("poster").batch).toBe(false);
  });
});

describe("marketing agent: motion", () => {
  it("animates the product photo for 5 to 15 seconds", () => {
    const s = styleOf("motion");
    const res = job(s.id, { product: PRODUCT, duration: 10, aspect: "9:16" });
    expect(res.params).toMatchObject({ image: PRODUCT, duration: 10, aspect_ratio: "9:16" });
    expect(composeMarketingJob(s.id, { product: PRODUCT, duration: 4 }, has)).toEqual({ ok: false, error: "duration_invalid" });
    expect(composeMarketingJob(s.id, { product: PRODUCT, duration: 16 }, has)).toEqual({ ok: false, error: "duration_invalid" });
    expect(job(s.id, { product: PRODUCT }).params.duration).toBe(flowRules("motion").duration!.default);
  });
});

describe("marketing agent: wish", () => {
  it("adds the wish trimmed and capped, without breaking the prompt", () => {
    const s = styleOf("product_shots");
    const res = job(s.id, { product: PRODUCT, wish: `  auf einem Marmortisch ${"x".repeat(600)}` });
    const prompt = String(res.params.prompt);
    expect(prompt).toContain("auf einem Marmortisch");
    expect(prompt.length).toBeLessThan(s.prompt.length + 400);
  });

  it("rejects unknown styles", () => {
    expect(composeMarketingJob("nope", { product: PRODUCT }, has)).toEqual({ ok: false, error: "unknown_style" });
  });

  it("findStyle finds by id", () => {
    expect(findStyle(MS_STYLES[0]!.id)).toBe(MS_STYLES[0]);
  });
});

describe("marketing agent: UGC (two steps)", () => {
  const ugc = () => MS_STYLES.find((s) => s.flow === "ugc")!;

  it("step 1 is a still of the avatar holding the product; step 2 is known up front", () => {
    const res = job(ugc().id, { product: PRODUCT, avatar: AVATAR, wish: "Das benutze ich jeden Tag", duration: 6 });
    expect(res.jobType).toBe(flowRules("ugc").frameJobType);
    expect(res.params.references).toEqual([PRODUCT, AVATAR]);
    expect(String(res.params.prompt)).toMatch(/image 1/);
    expect(res.next).toEqual({ jobType: flowRules("ugc").jobType, duration: 6, aspect: "9:16", line: "Das benutze ich jeden Tag" });
  });

  it("needs avatar, product and the spoken line", () => {
    expect(composeMarketingJob(ugc().id, { product: PRODUCT, wish: "Hello" }, has)).toEqual({ ok: false, error: "avatar_required" });
    expect(composeMarketingJob(ugc().id, { product: PRODUCT, avatar: AVATAR }, has)).toEqual({ ok: false, error: "line_required" });
  });

  it("only takes the lengths the video model renders (4, 6, 8 s)", () => {
    expect(composeMarketingJob(ugc().id, { product: PRODUCT, avatar: AVATAR, wish: "Hello", duration: 5 }, has)).toEqual({ ok: false, error: "duration_invalid" });
  });

  it("step 2 animates the still and speaks the line without quote marks", () => {
    const frame = "/api/media/uploads/00000000-0000-4000-8000-000000000001/frame.png";
    const res = composeUgcVideo(ugc().id, { frame, wish: '"Mein Favorit"', duration: 8 }, has);
    if (!res.ok) throw new Error(res.error);
    expect(res.params).toMatchObject({ image: frame, duration: 8, aspect_ratio: "9:16", generate_audio: true });
    expect(String(res.params.prompt)).toContain("Mein Favorit.");
    expect(String(res.params.prompt)).not.toMatch(/["“”„«»]/);
    expect(catalog.get(res.jobType)!.params.safeParse(res.params).success).toBe(true);
    expect(composeUgcVideo(ugc().id, { frame, wish: "x", duration: 5 }, has)).toEqual({ ok: false, error: "duration_invalid" });
  });

  it("is offered only when both models of the chain are in the catalogue", () => {
    expect(styleAvailable(ugc(), (jt) => jt !== flowRules("ugc").jobType)).toBe(false);
    expect(styleAvailable(ugc(), has)).toBe(true);
  });
});

describe("marketing agent: templates", () => {
  it("every template builds on a known style, ids are unique across styles and templates", () => {
    const ids = [...MS_STYLES.map((s) => s.id), ...MS_TEMPLATES.map((t) => t.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of MS_TEMPLATES) expect(findStyle(t.id)?.base, t.id).toBe(t.style);
  });

  it("covers every category with templates, product shots the most", () => {
    const pub = publicTemplates(has);
    const per = (c: string) => pub.filter((t) => t.category === c).length;
    for (const c of MS_CATEGORIES) expect(per(c.id), c.id).toBeGreaterThanOrEqual(3);
    expect(per("product")).toBeGreaterThan(per("ads"));
  });

  it("gives every style at least three templates, so each level of the studio has finished examples", () => {
    for (const s of MS_STYLES) expect(MS_TEMPLATES.filter((t) => t.style === s.id).length, s.id).toBeGreaterThanOrEqual(3);
  });

  it("a UGC template brings its own still and its own video scene", () => {
    const t = MS_TEMPLATES.find((x) => x.frame && findStyle(x.style)!.flow === "ugc")!;
    expect(t).toBeDefined();
    const res = job(t.id, { product: PRODUCT, avatar: AVATAR, wish: "Das benutze ich jeden Tag" });
    expect(String(res.params.prompt)).toContain(t.frame!.slice(30, 80));
    expect(findStyle(t.id)!.prompt).toBe(t.prompt);
  });

  it("a template runs with its own prompt and its base style's rules, never showing the prompt", () => {
    const t = MS_TEMPLATES.find((x) => x.prompt && findStyle(x.style)!.flow === "product_shots")!;
    const res = job(t.id, { product: PRODUCT });
    expect(String(res.params.prompt)).toContain("image 1");
    expect(res.params.prompt).not.toBe(findStyle(t.style)!.prompt.replace("{product}", "the product from image 1"));
    const pub = publicTemplates(has).find((x) => x.id === t.id) as Record<string, unknown>;
    expect(JSON.stringify(pub)).not.toContain(t.prompt!.slice(20, 60));
    expect(pub.cover).toBe(`/marketing/${t.id}.webp`);
  });
});
