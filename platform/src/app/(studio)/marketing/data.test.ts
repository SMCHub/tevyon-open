import { describe, expect, it } from "vitest";
import { briefText, filterResults, filterTemplates, moreTemplates, nextProjectName, parseProject, parseTemplate, parseView, quoteBody, repeatable, runOf, searchProjects, sortProjects, startBody, viewHref, wishField, withJobs, withoutJob, type Project, type Style } from "./data";

const ACC = "00000000-0000-4000-8000-000000000001";
const UP = (n: string) => `/api/media/uploads/${ACC}/${n}.jpg`;

function style(over: Partial<Style> = {}): Style {
  return {
    id: "ps-plinth", category: "product", flow: "product_shots", kind: "image", title: "Plinth", group: "Studio",
    aspect: "3:4", aspects: ["1:1", "3:4", "9:16"], batch: true, duration: null, product: "required", avatar: "none", adReference: true,
    wishHint: null, badge: null, available: true, lettering: false, spoken: false, chain: false, cover: null, base: null, coverShape: "2:3", credits: 12,
    ...over,
  };
}

describe("marketing agent page: views and links", () => {
  it("reads every view from the URL and falls back to the start page", () => {
    expect(parseView("generations")).toBe("generations");
    expect(parseView("agent")).toBe("agent");
    expect(parseView("nope")).toBe("home");
    expect(parseView(null)).toBe("home");
  });

  it("links each view, with category and style where given", () => {
    expect(viewHref("home")).toBe("/marketing");
    expect(viewHref("favorites")).toBe("/marketing?view=favorites");
    expect(viewHref("home", { category: "ads", style: "ad-claim" })).toBe("/marketing?category=ads&style=ad-claim");
  });
});

describe("marketing agent page: runs", () => {
  it("reads a job's run from its tag, own uploads only", () => {
    const params = {
      recipe: { id: "ms:pp-hand", title: "Marketing Agent · Hand", wish: "Summer", inputs: { product: UP("p"), avatar: "https://evil.example/x.jpg", aspect: "9:16", count: 2, duration: 1.5 } },
      references: [UP("p")],
    };
    expect(runOf(params)).toEqual({ styleId: "pp-hand", wish: "Summer", product: UP("p"), aspect: "9:16", count: 2 });
    expect(runOf({ recipe: { id: "superhero-pet" } })).toBeNull();
    expect(runOf({ prompt: "x" })).toBeNull();
  });

  it("repeats a run only when the style runs and its required files are known", () => {
    expect(repeatable({ styleId: "x", product: UP("p") }, style())).toBe(true);
    expect(repeatable({ styleId: "x" }, style())).toBe(false);
    expect(repeatable({ styleId: "x", product: UP("p") }, style({ available: false }))).toBe(false);
    expect(repeatable({ styleId: "x", product: UP("p"), avatar: UP("a") }, style({ flow: "ugc", spoken: true, avatar: "required" }))).toBe(false);
    expect(repeatable({ styleId: "x", wish: "Party" }, style({ flow: "poster", product: "optional" }))).toBe(true);
  });

  it("builds start and quote bodies that send only what the style takes", () => {
    const s = style({ avatar: "none", adReference: false, batch: false });
    const run = { styleId: s.id, product: UP("p"), avatar: UP("a"), adReference: UP("r"), aspect: "21:9", wish: "New" };
    expect(startBody(run, s, { count: 3, maxCredits: 12 })).toEqual({ styleId: s.id, product: UP("p"), wish: "New", count: 1, maxCredits: 12 });
    expect(quoteBody(run, s)).toEqual({ styleId: s.id, product: true, avatar: false, adReference: false });
    const people = style({ avatar: "optional", aspects: ["9:16"] });
    expect(startBody({ ...run, aspect: "9:16" }, people, { count: 9, consent: true })).toMatchObject({ avatar: UP("a"), consent: true, aspect: "9:16", count: 4, adReference: UP("r") });
  });
});

describe("marketing agent page: templates", () => {
  const styles = [style(), style({ id: "ad-claim", category: "ads", flow: "ads", title: "Big claim", group: null })];
  const templates = [
    style({ id: "tpl-marble", base: "ps-plinth", title: "Marble morning" }),
    style({ id: "tpl-ad", base: "ad-claim", category: "ads", title: "Citrus" }),
    style({ id: "tpl-mo", base: "mo", category: "motion", kind: "video", title: "Orbit" }),
  ];

  it("filters by category and media type", () => {
    expect(filterTemplates(templates, styles, { category: "ads", media: "all", q: "" }).map((t) => t.id)).toEqual(["tpl-ad"]);
    expect(filterTemplates(templates, styles, { category: "all", media: "video", q: "" }).map((t) => t.id)).toEqual(["tpl-mo"]);
  });

  it("searches titles and the base style, ignoring case and accents", () => {
    expect(filterTemplates(templates, styles, { category: "all", media: "all", q: "marble" }).map((t) => t.id)).toEqual(["tpl-marble"]);
    expect(filterTemplates(templates, styles, { category: "all", media: "all", q: "CLAIM citrus" }).map((t) => t.id)).toEqual(["tpl-ad"]);
    expect(filterTemplates(templates, styles, { category: "all", media: "all", q: "plinth" }).map((t) => t.id)).toEqual(["tpl-marble"]);
    expect(filterTemplates(templates, styles, { category: "all", media: "all", q: "nothing" })).toEqual([]);
  });

});

describe("marketing agent page: template dialog", () => {
  it("links a template's dialog and reads only well-formed ids back", () => {
    expect(viewHref("home", { category: "product", style: "tpl-marble", template: "tpl-marble" })).toBe("/marketing?category=product&style=tpl-marble&template=tpl-marble");
    expect(viewHref("generations", { template: "tpl-ad" })).toBe("/marketing?view=generations&template=tpl-ad");
    expect(parseTemplate("tpl-marble")).toBe("tpl-marble");
    expect(parseTemplate("../etc")).toBeNull();
    expect(parseTemplate("")).toBeNull();
    expect(parseTemplate(null)).toBeNull();
  });

  it("names the text by what the style does with it: spoken, lettering, a description it needs, or an optional wish", () => {
    expect(wishField(style({ flow: "ugc", spoken: true, wishHint: "e.g. Lasts forever" }), true)).toMatchObject({ role: "spoken", required: true, max: 160 });
    expect(wishField(style({ flow: "ugc", spoken: true, wishHint: "e.g. Lasts forever" }), true).placeholder).toContain("Lasts forever");
    expect(wishField(style({ flow: "ads", lettering: true }), true)).toMatchObject({ role: "lettering", required: false, max: 200 });
    expect(wishField(style({ flow: "poster", product: "optional" }), false)).toMatchObject({ role: "describe", required: true });
    expect(wishField(style({ flow: "poster", product: "optional" }), true)).toMatchObject({ role: "wish", required: false });
    expect(wishField(style({ flow: "motion", kind: "video", product: "optional" }), false)).toMatchObject({ role: "describe", required: true });
    expect(wishField(style(), true).placeholder).toMatch(/light/);
    expect(wishField(style({ flow: "motion", kind: "video" }), true).placeholder).toMatch(/motion/);
  });

  it("offers more templates of the same category, runnable ones first, never the open one", () => {
    const t = (id: string, over: Partial<Style> = {}) => style({ id, base: "ps-plinth", ...over });
    const list = [t("a"), t("b", { available: false }), t("c"), t("d", { category: "ads" }), t("e")];
    expect(moreTemplates(list, list[0]!, 3).map((x) => x.id)).toEqual(["c", "e", "b"]);
    expect(moreTemplates(list, list[0]!, 1).map((x) => x.id)).toEqual(["c"]);
    expect(moreTemplates(list, list[3]!, 4)).toEqual([]);
  });
});

describe("marketing agent page: results", () => {
  const jobs = [
    { id: "a", status: "succeeded", video: false },
    { id: "b", status: "failed", video: false },
    { id: "c", status: "succeeded", video: true },
    { id: "d", status: "running", video: true },
  ];
  const isVideo = (j: (typeof jobs)[number]) => j.video;

  it("filters by media type and hides failed runs on request, keeping running ones", () => {
    expect(filterResults(jobs, { media: "all", hideFailed: false }, isVideo).map((j) => j.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterResults(jobs, { media: "all", hideFailed: true }, isVideo).map((j) => j.id)).toEqual(["a", "c", "d"]);
    expect(filterResults(jobs, { media: "image", hideFailed: true }, isVideo).map((j) => j.id)).toEqual(["a"]);
    expect(filterResults(jobs, { media: "video", hideFailed: false }, isVideo).map((j) => j.id)).toEqual(["c", "d"]);
  });
});

describe("marketing agent page: projects", () => {
  const J = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const pr = (id: string, over: Partial<Project> = {}): Project => ({ id, name: id, jobIds: [], pinned: false, createdAt: 0, ...over });

  it("links the project views and reads only well-formed project ids back", () => {
    expect(parseView("projects")).toBe("projects");
    expect(parseView("project")).toBe("project");
    expect(viewHref("project", { project: "p-1" })).toBe("/marketing?view=project&project=p-1");
    expect(parseProject("3f1c2b9e-1111-4222-8333-944445555666")).toBe("3f1c2b9e-1111-4222-8333-944445555666");
    expect(parseProject("../x")).toBeNull();
    expect(parseProject(null)).toBeNull();
  });

  it("puts new generations first, each once, at most 500, and takes one out again", () => {
    const p = pr("a", { jobIds: [J(1), J(2)] });
    expect(withJobs(p, [J(3), J(1)]).jobIds).toEqual([J(3), J(1), J(2)]);
    expect(withJobs(pr("b", { jobIds: Array.from({ length: 500 }, (_, i) => J(i)) }), [J(900)]).jobIds).toHaveLength(500);
    expect(withJobs(pr("b", { jobIds: Array.from({ length: 500 }, (_, i) => J(i)) }), [J(900)]).jobIds[0]).toBe(J(900));
    expect(withoutJob(p, J(1)).jobIds).toEqual([J(2)]);
  });

  it("sorts pinned projects first, then by last activity, name or creation, and searches names", () => {
    const list = [pr("b", { name: "Beta", createdAt: 2 }), pr("a", { name: "Alpha", createdAt: 1, pinned: true }), pr("c", { name: "Ćirko", createdAt: 3 })];
    const active = (x: Project) => ({ a: 1, b: 9, c: 5 })[x.id as "a" | "b" | "c"];
    expect(sortProjects(list, "active", active).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(sortProjects(list, "name", active).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(sortProjects(list, "created", active).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(searchProjects(list, "cirko").map((x) => x.id)).toEqual(["c"]);
    expect(searchProjects(list, "  ").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("names a new project after the highest number in use", () => {
    expect(nextProjectName([])).toBe("Project 1");
    expect(nextProjectName([pr("a", { name: "Project 1" }), pr("b", { name: "Project 4" }), pr("c", { name: "Summer" })])).toBe("Project 5");
  });
});

describe("marketing agent page: brief", () => {
  it("writes the brief as one short message, leaving out what is empty", () => {
    expect(briefText({ goal: "Launch", channels: ["Instagram Reels", "Shop"], audience: " young city dwellers ", offer: "", tone: null, language: "English" })).toBe(
      "Goal: Launch\nChannels: Instagram Reels, Shop\nAudience: young city dwellers\nLanguage of the texts: English",
    );
  });
});
