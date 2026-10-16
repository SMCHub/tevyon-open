"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, RefreshCw } from "lucide-react";
import { JOB_ERROR } from "@/components/studio/content";
import { Lightbox } from "@/components/studio/job-views";
import { useStudio, type Job } from "@/components/studio/studio-context";
import { uploadImage } from "@/components/studio/upload";
import { CampaignAgent } from "./agent";
import { Builder, type BuilderState } from "./builder";
import { moreTemplates, nextProjectName, parseProject, parseTemplate, parseView, runOf, viewHref, wishField, withJobs, withoutJob, type AdRef, type Chain, type Kind, type Overview, type Product, type Project, type ProjectSort, type Run, type Style, type TemplateFilter, type View } from "./data";
import { GFolder, GMenu, GStack, GStar } from "./icons";
import { ProductLibrary, ReferenceLibrary } from "./library";
import { outputOf, ProjectHead, ProjectsView, type ProjectsApi } from "./projects";
import { createLibrarySender, diffList, mergeFirst, type ItemKind, type ServerItem } from "./library-sync";
import { RecentStrip, Results, type StartResponse } from "./results";
import { Sidebar } from "./sidebar";
import { TemplateDialog } from "./template-dialog";
import { StyleDialog, TemplateExplorer } from "./templates";
import "./marketing.css";

const MS_ERROR: Record<string, string> = {
  ...JOB_ERROR,
  unknown_style: "This style no longer exists.",
  style_unavailable: "This style is not available right now.",
  product_image_required: "Please choose a product photo first.",
  avatar_required: "UGC needs an avatar photo.",
  poster_content_required: "A product photo or a description, one of the two.",
  line_required: "Write the sentence the avatar says.",
  consent_required: "Please confirm the consent of the person shown.",
  batch_size_invalid: "This count is not possible here.",
  aspect_ratio_invalid: "This format does not fit this style.",
  duration_invalid: "This length does not fit this style.",
  frame_not_ready: "The still is not done yet.",
  not_found: "The still no longer exists.",
  frame_failed: "The still failed; the Credits are back.",
  not_an_image: "The still could not be used further. Nothing was charged for the video.",
};
const errorText = (code: string | undefined) => MS_ERROR[code ?? ""] ?? "That did not work. Please try again.";

// Same keys as before the rename, so saved products, favourites and open UGC chains stay.
const PRODUCTS_KEY = "tachyon:ms:products";
const FAVORITES_KEY = "tachyon:ms:favorites";
const CHAINS_KEY = "tachyon:ms:chains";
const REFS_KEY = "tachyon:ms:adrefs";
const SIDEBAR_KEY = "tachyon:ma:sidebar";
const PROJECTS_KEY = "tachyon:ma:projects";
const PROJECT_SORT_KEY = "tachyon:ma:projectsort";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Saved products, references, favourites and open UGC chains live in this browser (no server table yet). */
function useLocalList<T>(key: string, initial: T, normalize?: (raw: never) => T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const raw = loadJson(key, initial);
    setValue(normalize ? normalize(raw as never) : raw);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = useCallback((next: (v: T) => T) => setValue((v) => {
    const n = next(v);
    saveJson(key, n);
    return n;
  }), [key]);
  return [value, update] as const;
}

type ServerLibrary = Record<ItemKind, ServerItem[]>;

/** The account's library on the server, or "local" while it is not there (no table yet, offline): then the browser copy rules. */
function useServerLibrary() {
  const [lib, setLib] = useState<ServerLibrary | "local" | null>(null);
  useEffect(() => {
    fetch("/api/marketing/library", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ok?: boolean; library?: ServerLibrary } | null) => setLib(d?.ok && d.library ? d.library : "local"))
      .catch(() => setLib("local"));
  }, []);
  return lib;
}

/** Per kind: drops an item the server refused for good from the page and the browser copy (useSyncedList). */
const onRefused = new Map<ItemKind, (id: string) => void>();
/** Library changes to the server: one per item at a time, typing gathered into one change (library-sync.ts). */
const library = createLibrarySender(
  (method, path, body, keepalive) => fetch(path, { method, keepalive, ...(body ? { body: JSON.stringify(body) } : {}) }),
  400,
  (kind, id) => onRefused.get(kind)?.(id),
);
let flushOnLeave = false;
function send(method: "PUT" | "DELETE", kind: ItemKind, id: string, data?: Record<string, unknown>) {
  library.send(method, kind, id, data);
  if (!flushOnLeave) {
    flushOnLeave = true;
    // Leaving the page sends what is still waiting.
    window.addEventListener("pagehide", library.flush);
  }
}

/**
 * A list kept in this browser and, once the server library answers, in step with it: the first look merges (server
 * wins, browser-only items are uploaded), every later change stores or removes just what changed.
 */
function useSyncedList<T extends { id: string }>(
  key: string, kind: ItemKind, server: ServerLibrary | "local" | null,
  toData: (t: T) => Record<string, unknown>, fromItem: (i: ServerItem) => T | null, normalize: (raw: unknown[]) => T[] = (r) => r as T[],
) {
  const [list, setList] = useLocalList<T[]>(key, [], normalize);
  const live = useRef(false);
  /** The list as last changed: the next change starts from it, even before React renders. */
  const current = useRef(list);
  current.current = list;
  // A browser copy can hold items the account cannot store (e.g. another account's uploads in this browser): the
  // server refuses them, so they leave the page instead of coming back on every visit.
  useEffect(() => {
    onRefused.set(kind, (id) => {
      const n = current.current.filter((t) => t.id !== id);
      current.current = n;
      setList(() => n);
    });
    return () => void onRefused.delete(kind);
  }, [kind, setList]);
  useEffect(() => {
    if (!server || server === "local" || live.current) return;
    live.current = true;
    // An older server may not know a kind yet (deploy in progress): then it has none of them.
    const fromServer = (server[kind] ?? []).map(fromItem).filter((t): t is T => t !== null);
    const { list: merged, upload } = mergeFirst(fromServer, normalize(loadJson<unknown[]>(key, [])));
    setList(() => merged);
    for (const t of upload) send("PUT", kind, t.id, toData(t));
  }, [server]); // eslint-disable-line react-hooks/exhaustive-deps
  // The requests go out here, never inside a state updater: React may run an updater twice (and does in development).
  const update = useCallback((next: (v: T[]) => T[]) => {
    const prev = current.current;
    const n = next(prev);
    current.current = n;
    setList(() => n);
    if (live.current) {
      const d = diffList(prev, n, toData);
      for (const t of d.put) send("PUT", kind, t.id, toData(t));
      for (const id of d.remove) send("DELETE", kind, id);
    }
  }, [setList, kind, toData]);
  return [list, update] as const;
}

const productData = ({ id: _id, ...p }: Product) => ({ ...p });
const productOf = (i: ServerItem): Product | null => {
  const d = i.data as Partial<Product>;
  return Array.isArray(d.images) && d.images.length ? { id: i.id, name: String(d.name ?? "Product"), description: String(d.description ?? ""), images: d.images, pick: d.pick ?? 0, ...(d.source ? { source: d.source } : {}) } : null;
};
const refData = ({ url, name }: AdRef) => ({ url, name });
const refOf = (i: ServerItem): AdRef | null => (typeof i.data.url === "string" ? { id: i.id, url: i.data.url, name: String(i.data.name ?? "Reference") } : null);
type Fav = { id: string };
const favData = (f: Fav) => ({ jobId: f.id });
const favOf = (i: ServerItem): Fav => ({ id: i.id });
const projectData = ({ id: _id, ...p }: Project) => ({ ...p });
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const projectOf = (i: ServerItem): Project => ({
  id: i.id, name: String(i.data.name ?? "Project"), jobIds: strings(i.data.jobIds), pinned: i.data.pinned === true,
  createdAt: typeof i.data.createdAt === "number" ? i.data.createdAt : 0,
});
const projectNormalize = (raw: unknown[]): Project[] => raw.flatMap((x) => {
  const p = x as Partial<Project> | null;
  return p && typeof p.id === "string" && typeof p.name === "string" ? [{ id: p.id, name: p.name, jobIds: strings(p.jobIds), pinned: p.pinned === true, createdAt: typeof p.createdAt === "number" ? p.createdAt : 0 }] : [];
});
/** Favourites were plain job ids in the browser before. */
const favNormalize = (raw: unknown[]): Fav[] => raw.flatMap((x) => (typeof x === "string" ? [{ id: x }] : x && typeof x === "object" && typeof (x as Fav).id === "string" ? [x as Fav] : []));

const isMs = (j: Job) => runOf(j.params) !== null;
/** Results that can be a product photo again: finished raster images (the copy checks the bytes as well). */
const RASTER = /^image\/(png|jpeg|webp)$/;
const JOB_ID = /^[0-9a-f-]{36}$/i;
const EMPTY: BuilderState = { wish: "", aspect: null, duration: null, count: 1, avatar: null, adRef: null, consent: false };

export function MarketingAgent() {
  const { me, jobs, refresh } = useStudio();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = parseView(search.get("view"));
  /** The template whose dialog (“Recreate”) is open, from `?template=`. */
  const templateId = parseTemplate(search.get("template"));
  /** The open project (`?view=project&project=`). */
  const projectId = view === "project" ? parseProject(search.get("project")) : null;

  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [category, setCategory] = useState<string>(search.get("category") ?? "product");
  const [styleId, setStyleId] = useState<string | null>(parseTemplate(search.get("template")) ?? search.get("style"));

  const server = useServerLibrary();
  const [products, setProducts] = useSyncedList<Product>(PRODUCTS_KEY, "product", server, productData, productOf);
  const [favs, setFavs] = useSyncedList<Fav>(FAVORITES_KEY, "favorite", server, favData, favOf, favNormalize);
  const favorites = useMemo(() => favs.map((f) => f.id), [favs]);
  const [chains, setChains] = useLocalList<Chain[]>(CHAINS_KEY, []);
  const [refs, setRefs] = useSyncedList<AdRef>(REFS_KEY, "reference", server, refData, refOf);
  const [projects, setProjects] = useSyncedList<Project>(PROJECTS_KEY, "project", server, projectData, projectOf, projectNormalize);
  const [projectSort, setProjectSort] = useState<ProjectSort>("active");
  useEffect(() => {
    const v = loadJson<string>(PROJECT_SORT_KEY, "active");
    if (v === "name" || v === "created" || v === "active") setProjectSort(v);
  }, []);
  const [productId, setProductId] = useState<string | null>(null);
  const [c, setC] = useState<BuilderState>(EMPTY);
  const patch = useCallback((p: Partial<BuilderState>) => setC((s) => ({ ...s, ...p })), []);
  const [price, setPrice] = useState<number | null>(null);
  const [priceState, setPriceState] = useState<"idle" | "loading" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  const [filter, setFilter] = useState<TemplateFilter>({ category: "all", media: "all", q: "" });
  const [open, setOpen] = useState<{ list: Job[]; index: number } | null>(null);
  // Slim by default (as stored): starting wide would open and close the sidebar on every load.
  const [collapsed, setCollapsed] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const stage = useRef<HTMLElement>(null);
  /** A run waiting to be applied once its style is chosen (“Adjust”): its settings win over the style's defaults. */
  const pending = useRef<Run | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    fetch("/api/marketing", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Overview) => {
        // ?template= or ?style= brings its own category along, whatever ?category= says.
        const want = parseTemplate(search.get("template")) ?? search.get("style");
        const linked = [...d.styles, ...d.templates].find((s) => s.id === want);
        if (linked) setCategory(linked.category);
        setData(d);
      })
      .catch(() => setLoadError(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  useEffect(() => {
    setCollapsed(loadJson(SIDEBAR_KEY, true));
  }, []);

  const categories = useMemo(() => data?.categories ?? [], [data]);
  const styles = useMemo(() => data?.styles ?? [], [data]);
  const templates = useMemo(() => data?.templates ?? [], [data]);
  const all = useMemo(() => [...styles, ...templates], [styles, templates]);
  const find = useCallback((id: string) => all.find((s) => s.id === id), [all]);
  const style = (styleId && find(styleId)) || null;
  const kind: Kind = style?.kind ?? categories.find((x) => x.id === category)?.kind ?? "image";
  const product = products.find((p) => p.id === productId) ?? null;
  const productImage = product ? product.images[product.pick] ?? product.images[0] ?? null : null;

  // Every view has its URL (back button, links); category and style follow without a new history entry.
  const go = useCallback((v: View, extra: { category?: string | null; style?: string | null; project?: string | null } = {}) => {
    router.push(viewHref(v, extra), { scroll: false });
  }, [router]);
  /** A template dialog on its way into the URL: the sync below waits until `?template=` shows it. */
  const opening = useRef<string | null>(null);
  useEffect(() => {
    if (opening.current) {
      if (templateId === opening.current) opening.current = null;
      return;
    }
    if (view !== "home" || !style) return;
    const want = viewHref("home", { category: style.category, style: style.id, template: templateId });
    const now = `${pathname}${search.toString() ? `?${search.toString()}` : ""}`;
    if (now !== want && !search.get("from") && !search.get("animate")) router.replace(want, { scroll: false });
  }, [style?.id, view, templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A category opens on its first style that runs today; a chosen style or template brings its category along.
  useEffect(() => {
    if (!styles.length) return;
    if (style && style.category === category) return;
    const first = styles.find((s) => s.category === category && s.available) ?? styles.find((s) => s.category === category);
    setStyleId(first?.id ?? null);
  }, [category, styles]); // eslint-disable-line react-hooks/exhaustive-deps

  // The text means something else per style: spoken (UGC), lettering in the image, or a scene wish. Each meaning keeps
  // its own text, so a scene wish never becomes an ad's lettering or the sentence a person says.
  const texts = useRef<{ role: string | null; saved: Record<string, string> }>({ role: null, saved: {} });

  // Settings follow the style: its format, its default length, batch only where the flow allows it, or a pending run.
  useEffect(() => {
    if (!style) return;
    const run = pending.current?.styleId === style.id ? pending.current : null;
    pending.current = null;
    const role = style.spoken ? "spoken" : style.lettering ? "lettering" : "scene";
    const before = texts.current.role;
    texts.current.role = role;
    setC((s) => ({
      ...s,
      ...(before && before !== role && !run ? (() => {
        texts.current.saved[before] = s.wish;
        return { wish: texts.current.saved[role] ?? "" };
      })() : {}),
      aspect: run?.aspect && style.aspects.includes(run.aspect) ? run.aspect : style.aspect,
      duration: run?.duration !== undefined && style.duration ? run.duration : style.duration?.default ?? null,
      count: style.batch ? (run?.count ?? s.count) : 1,
      adRef: style.adReference ? (run ? run.adReference ?? null : s.adRef) : null,
      ...(run ? { wish: run.wish ?? "", avatar: style.avatar !== "none" ? run.avatar ?? null : null, consent: false } : {}),
    }));
  }, [style?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const useAvatar = style ? style.avatar !== "none" && Boolean(c.avatar) : false;
  const useAdRef = Boolean(style?.adReference && c.adRef);

  // The price of one run for exactly these settings; the button multiplies by the count.
  useEffect(() => {
    if (!style?.available) {
      setPrice(null);
      setPriceState("idle");
      return;
    }
    const ctl = new AbortController();
    setPriceState("loading");
    const body = {
      styleId: style.id, product: Boolean(productImage) || style.product === "required", avatar: useAvatar, adReference: useAdRef,
      ...(c.aspect ? { aspect: c.aspect } : {}), ...(c.duration !== null ? { duration: c.duration } : {}),
    };
    fetch("/api/marketing/quote", { method: "POST", body: JSON.stringify(body), signal: ctl.signal })
      .then((r) => r.json())
      .then((q: { ok: boolean; credits?: number }) => {
        setPrice(q.ok ? q.credits! : null);
        setPriceState(q.ok ? "idle" : "error");
      })
      .catch(() => !ctl.signal.aborted && setPriceState("error"));
    return () => ctl.abort();
  }, [style?.id, style?.available, productImage, useAvatar, useAdRef, c.aspect, c.duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = price !== null ? price * c.count : null;
  const tooExpensive = me !== null && total !== null && total > me.credits;
  const needsWish = style ? wishField(style, Boolean(productImage)).required : false;
  const missing = !data ? "Loading …"
    : !style ? "Choose a style"
    : !style.available ? "Coming soon"
    : style.product === "required" && !productImage ? "Product missing"
    : style.avatar === "required" && !c.avatar ? "Avatar missing"
    : needsWish && !c.wish.trim() ? (style.spoken ? "Sentence missing" : "Text missing")
    : useAvatar && !c.consent ? "Consent missing"
    : priceState === "error" ? "No price"
    : tooExpensive ? "Not enough Credits"
    : null;
  const canGo = !missing && !busy && price !== null && priceState !== "loading";

  /** The project runs started now go into (the open one), read at start time. */
  const activeProject = useRef<string | null>(null);
  activeProject.current = projectId;
  const projectsNow = useRef(projects);
  projectsNow.current = projects;
  const addToProject = useCallback((id: string, jobIds: string[]) => {
    setProjects((list) => list.map((x) => (x.id === id ? withJobs(x, jobIds) : x)));
  }, [setProjects]);

  /** After any start: remember a UGC chain, file the runs into the open project, refresh the jobs. */
  const started = useCallback(async (res: StartResponse) => {
    const next = res.next;
    const into = activeProject.current;
    if (next && res.jobs?.[0]) setChains((list) => [{ frameJobId: res.jobs![0]!.id, ...next, ...(into ? { projectId: into } : {}) }, ...list].slice(0, 20));
    if (into && res.jobs?.length) addToProject(into, res.jobs.map((j) => j.id));
    await refresh();
    const where = into ? `in “${projectsNow.current.find((x) => x.id === into)?.name ?? "this project"}”` : "under “Recently created”";
    setToast(res.partial ? `${res.jobs?.length ?? 0} started. ${errorText(res.partial)}` : (res.jobs?.length ?? 0) > 1 ? `${res.jobs!.length} runs started; they appear ${where}.` : `Started. The result appears ${where}.`);
  }, [refresh, setChains, addToProject]);

  async function generate() {
    if (!canGo || !style) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/marketing", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        styleId: style.id,
        ...(productImage && style.product !== "none" ? { product: productImage } : {}),
        ...(useAvatar ? { avatar: c.avatar, consent: c.consent } : {}),
        ...(useAdRef ? { adReference: c.adRef } : {}),
        ...(c.wish.trim() ? { wish: c.wish.trim() } : {}),
        ...(c.aspect && style.aspects.length ? { aspect: c.aspect } : {}),
        ...(c.duration !== null ? { duration: c.duration } : {}),
        count: c.count,
        maxCredits: price,
      }),
    }).catch(() => undefined);
    const res = (await r?.json().catch(() => undefined)) as StartResponse | undefined;
    setBusy(false);
    if (!res?.ok) {
      if (res?.error === "price_changed" && res.credits !== undefined) setPrice(res.credits);
      return setError(res?.error === "price_changed" && res.credits !== undefined
        ? `The price just changed: now ${res.credits} Credits per run. Check it and start again.`
        : r === undefined ? "No connection. Check your network and try again." : errorText(res?.error));
    }
    await started(res);
    // Stay in the workspace: the new run shows at the top of the stage (“Recently created”).
    if (templateId) closeTemplate();
    else if (view !== "home" && view !== "project") go("home", { category, style: styleId });
    requestAnimationFrame(() => stage.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }

  // UGC step 2: as soon as a still is done, it gets its voice. A still that failed ends its chain (credits are back).
  const continuing = useRef(new Set<string>());
  useEffect(() => {
    for (const ch of chains) {
      if (ch.videoJobId || ch.error || continuing.current.has(ch.frameJobId)) continue;
      const frame = jobs.find((j) => j.id === ch.frameJobId);
      if (!frame) continue;
      if (frame.status === "failed") {
        setChains((list) => list.map((x) => (x.frameJobId === ch.frameJobId ? { ...x, error: "frame_failed" } : x)));
        continue;
      }
      if (frame.status !== "succeeded") continue;
      continuing.current.add(ch.frameJobId);
      void fetch("/api/marketing/ugc", {
        method: "POST",
        body: JSON.stringify({ frameJobId: ch.frameJobId, styleId: ch.styleId, wish: ch.wish, duration: ch.duration, aspect: ch.aspect, maxCredits: ch.credits }),
      })
        .then((r) => r.json())
        .then(async (res: { ok: boolean; error?: string; job?: { id: string } }) => {
          setChains((list) => list.map((x) => (x.frameJobId === ch.frameJobId ? (res.ok ? { ...x, videoJobId: res.job!.id } : { ...x, error: res.error ?? "unknown" }) : x)));
          if (res.ok && ch.projectId) addToProject(ch.projectId, [res.job!.id]);
          if (res.ok) await refresh();
        })
        .catch(() => continuing.current.delete(ch.frameJobId));
    }
  }, [chains, jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = chains.filter((x) => !x.videoJobId && !x.error);
  const chainErrors = chains.filter((x) => x.error && x.error !== "frame_failed");

  // Products: a quick upload becomes a product too, so it can be picked again later.
  // An earlier upload picked again (a URL) becomes a product the same way.
  async function addUpload(file: File | string) {
    const res = typeof file === "string" ? { url: file } : await uploadImage(file);
    if ("error" in res) return setError(res.error);
    const name = typeof file === "string" ? "Product" : file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Product";
    const p: Product = { id: crypto.randomUUID(), name, description: "", images: [res.url], pick: 0 };
    setProducts((list) => [p, ...list]);
    setProductId(p.id);
  }
  function addProduct(p: Omit<Product, "id" | "pick">) {
    const full: Product = { ...p, id: crypto.randomUUID(), pick: 0 };
    setProducts((list) => [full, ...list]);
    setProductId(full.id);
    return full;
  }
  const addRef = (r: AdRef) => setRefs((list) => [r, ...list.filter((x) => x.url !== r.url)].slice(0, 40));

  /** Own finished images (all studios), newest first: a result can be the product of the next run. */
  const results = useMemo(() => jobs
    .filter((j) => j.status === "succeeded" && j.outputs[0] && RASTER.test(j.outputs[0].contentType))
    .slice(0, 24)
    .map((j) => {
      const run = runOf(j.params);
      const label = (run ? find(run.styleId)?.title : undefined) ?? String(j.params.prompt ?? "").slice(0, 40);
      return { id: j.id, url: j.outputs[0]!.url, label: label || "Result" };
    }), [jobs, find]);
  /** A result as product: copied into the uploads (inputs are always own uploads) and saved like any product. */
  async function fromResult(jobId: string): Promise<string | null> {
    const r = await fetch("/api/uploads/from-job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, index: 0 }) }).catch(() => undefined);
    const res = (await r?.json().catch(() => undefined)) as { ok: boolean; url?: string } | undefined;
    if (!res?.ok || !res.url) return r === undefined ? "No connection. Please try again." : "This result cannot be used.";
    const label = results.find((x) => x.id === jobId)?.label;
    addProduct({ name: label ? `Result · ${label}`.slice(0, 60) : "From a result", description: "", images: [res.url] });
    return null;
  }

  const msJobs = useMemo(() => jobs.filter(isMs), [jobs]);
  const favJobs = useMemo(() => msJobs.filter((j) => favorites.includes(j.id)), [msJobs, favorites]);
  const running = msJobs.filter((j) => j.status === "queued" || j.status === "running").length;

  function toHome() {
    if (view !== "home") go("home", { category, style: styleId });
    requestAnimationFrame(() => { stage.current?.scrollTo({ top: 0, behavior: "smooth" }); window.scrollTo({ top: 0, behavior: "smooth" }); });
  }
  function chooseCategory(id: string) {
    setCategory(id);
    setError(null);
  }
  function chooseStyle(s: Style) {
    setCategory(s.category);
    setStyleId(s.id);
    setError(null);
  }
  /** From the sidebar: a style into the builder. */
  function selectStyle(s: Style) {
    chooseStyle(s);
    toHome();
  }
  /** A template opens its dialog (“Recreate”), with its own URL; the builder takes the same style. */
  const openedHere = useRef(false);
  function openTemplate(s: Style, replace = false) {
    opening.current = s.id;
    openedHere.current = !replace;
    chooseStyle(s);
    const href = viewHref("home", { category: s.category, style: s.id, template: s.id });
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }
  /** “Animate”: a finished image becomes the product of a Motion run, opened like a template with its price. */
  async function animate(jobId: string, replace = false): Promise<string | null> {
    const motion = styles.find((x) => x.category === "motion" && x.available);
    if (!motion) return "Motion is not available right now.";
    const err = await fromResult(jobId);
    if (err) return err;
    openTemplate(motion, replace);
    return null;
  }
  /** “More like this” in the dialog: another template in the same place in the history. */
  function switchTemplate(s: Style) {
    opening.current = s.id;
    chooseStyle(s);
    router.replace(viewHref("home", { category: s.category, style: s.id, template: s.id }), { scroll: false });
  }
  /** Back where the dialog came from; a dialog opened by a link closes in place. */
  function closeTemplate() {
    if (openedHere.current) {
      openedHere.current = false;
      router.back();
    } else {
      router.replace(viewHref("home", { category, style: styleId }), { scroll: false });
    }
  }
  const dialogTemplate = templateId && view === "home" ? find(templateId) ?? null : null;
  /** “Adjust”: a run's settings back into the composer (its product becomes a product if it is not one yet). */
  const applyRun = useCallback((run: Run) => {
    const s = find(run.styleId);
    if (!s) return setError("This style no longer exists.");
    if (run.product) {
      const known = products.find((p) => p.images.includes(run.product!));
      if (known) {
        setProductId(known.id);
        if (known.images[known.pick] !== run.product) setProducts((list) => list.map((p) => (p.id === known.id ? { ...p, pick: p.images.indexOf(run.product!) } : p)));
      } else {
        addProduct({ name: "From a result", description: "", images: [run.product] });
      }
    }
    pending.current = run;
    if (styleId === s.id) {
      // Same style: the style effect does not run again, so apply now.
      pending.current = null;
      setC((x) => ({
        ...x, wish: run.wish ?? "", aspect: run.aspect && s.aspects.includes(run.aspect) ? run.aspect : s.aspect,
        duration: run.duration ?? s.duration?.default ?? null, count: s.batch ? run.count ?? 1 : 1,
        avatar: s.avatar !== "none" ? run.avatar ?? null : null, adRef: s.adReference ? run.adReference ?? null : null, consent: false,
      }));
    }
    chooseStyle(s);
    setOpen(null);
    go("home", { category: s.category, style: s.id });
    requestAnimationFrame(() => { stage.current?.scrollTo({ top: 0, behavior: "smooth" }); window.scrollTo({ top: 0, behavior: "smooth" }); });
  }, [find, products, styleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?from=<job> (the large view's “Adjust in the Marketing Agent”): load that job's run once the job and styles are known.
  const fromDone = useRef<string | null>(null);
  useEffect(() => {
    const from = search.get("from");
    if (!from || fromDone.current === from || !data) return;
    const job = jobs.find((j) => j.id === from);
    if (!job) return;
    fromDone.current = from;
    const run = runOf(job.params);
    if (run) applyRun(run);
  }, [search, jobs, data, applyRun]);

  // ?animate=<job> (the large view's “Animate”): that image into a Motion run, once the styles are known.
  const animated = useRef<string | null>(null);
  useEffect(() => {
    const id = search.get("animate");
    if (!id || !JOB_ID.test(id) || animated.current === id || !data) return;
    animated.current = id;
    void animate(id, true).then((err) => {
      if (!err) return;
      setError(err);
      router.replace(viewHref("home", { category, style: styleId }), { scroll: false });
    });
  }, [search, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Projects: folders of generations. A new one opens at once; what starts while it is open goes in.
  const byId = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  function newProject(jobIds: string[] = [], open = true) {
    const p: Project = { id: crypto.randomUUID(), name: nextProjectName(projects), jobIds, pinned: false, createdAt: Date.now() };
    setProjects((list) => [p, ...list]);
    if (open) go("project", { project: p.id });
    else setToast(`Added to “${p.name}”.`);
  }
  const projectsApi: ProjectsApi = {
    list: projects,
    sort: projectSort,
    onSort: (v) => { setProjectSort(v); saveJson(PROJECT_SORT_KEY, v); },
    open: (id) => go("project", { project: id }),
    create: () => newProject(),
    rename: (id, name) => setProjects((list) => list.map((x) => (x.id === id ? { ...x, name } : x))),
    pin: (id) => setProjects((list) => list.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x))),
    remove: (id) => {
      setProjects((list) => list.filter((x) => x.id !== id));
      if (projectId === id) go("projects");
    },
    cover: (p) => {
      for (const id of p.jobIds) {
        const o = outputOf(byId.get(id));
        if (o) return o;
      }
      return null;
    },
    lastActive: (p) => Math.max(p.createdAt, byId.get(p.jobIds[0] ?? "")?.createdAt ?? 0),
  };
  const project = projectId ? projects.find((x) => x.id === projectId) ?? null : null;
  const projectJobs = useMemo(() => (project ? project.jobIds.map((id) => byId.get(id)).filter((j): j is Job => j !== undefined) : []), [project, byId]);
  const toProject = (jobId: string, target: string | "new") => {
    if (target === "new") return newProject([jobId], false);
    addToProject(target, [jobId]);
    setToast(`Added to “${projects.find((x) => x.id === target)?.name ?? "project"}”.`);
  };
  function switchKind(k: Kind) {
    if (k === kind) return;
    chooseCategory(k === "video" ? "ugc" : "product");
  }
  function sidebarCategory(id: string) {
    chooseCategory(id);
    setFilter((f) => ({ ...f, category: id }));
    toHome();
  }
  function setSidebar(v: boolean) {
    setCollapsed(v);
    saveJson(SIDEBAR_KEY, v);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const VIEW_TITLE: Record<View, string> = {
    home: "Home", agent: "Plan campaign", generations: "My generations", favorites: "Favourites", products: "Products", references: "Ad references",
    projects: "Projects", project: project?.name ?? "Project",
  };

  const builder = (
    <Builder
      categories={categories}
      category={category}
      onCategory={chooseCategory}
      style={style}
      base={style?.base ? find(style.base) ?? null : null}
      kind={kind}
      onKind={switchKind}
      onStyleDialog={() => setStyleOpen(true)}
      onAgent={() => go("agent")}
      state={c}
      onState={patch}
      products={products}
      product={product}
      productImage={productImage}
      onProduct={setProductId}
      onUpload={addUpload}
      onImport={addProduct}
      onManageProducts={() => go("products")}
      results={results}
      onResult={fromResult}
      refs={refs}
      onAddRef={addRef}
      onError={setError}
      error={error}
      missing={missing}
      price={price}
      priceState={priceState}
      balance={me?.credits ?? null}
      tooExpensive={tooExpensive}
      busy={busy}
      canGo={canGo}
      onGenerate={generate}
    />
  );
  const split = view === "home" || view === "generations" || view === "favorites" || view === "project";

  return (
    <div className={`ma${collapsed ? " is-slim" : ""}`}>
      <Sidebar
        view={view}
        onView={(v) => (v === "home" ? toHome() : go(v))}
        collapsed={collapsed}
        onCollapsed={setSidebar}
        open={drawer}
        onClose={() => setDrawer(false)}
        categories={categories}
        styles={styles}
        templates={templates}
        category={category}
        styleId={styleId}
        onCategory={sidebarCategory}
        onStyle={selectStyle}
        onSearch={(q) => { setFilter({ category: "all", media: "all", q }); go("home", { category, style: styleId }); requestAnimationFrame(() => document.getElementById("templates")?.scrollIntoView({ behavior: "smooth" })); }}
        counts={{ generations: msJobs.length, favorites: favJobs.length, products: products.length, references: refs.length, running }}
        products={products}
        productId={productId}
        onProduct={(id) => { setProductId(id); toHome(); }}
        projects={projectsApi}
        projectId={projectId}
        credits={me?.credits ?? null}
      />

      <div className={split ? "ma-split" : "ms-main"}>
        <div className="ma-mobilebar">
          <button type="button" className="ma-mobilebar__menu" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}><GMenu /></button>
          <span>{VIEW_TITLE[view]}</span>
        </div>

        {split && builder}

        {split && (
          <section className="stage ma-stage" ref={stage} aria-label={VIEW_TITLE[view]}>
            {loadError && (
              <div className="ma-alert" role="alert">
                <CircleAlert aria-hidden="true" />
                <span>The templates could not be loaded.</span>
                <button type="button" className="btn" onClick={load}><RefreshCw aria-hidden="true" /> Try again</button>
              </div>
            )}

            {view === "home" && (
              <>
                <header className="ma-head">
                  <div className="ma-head__text">
                    <h1 className="ma-head__title"><span>From a product photo</span> <em>to a finished campaign.</em></h1>
                    <p className="ma-head__sub">Choose a template, add your product, see the price, start. Or let the agent plan from a brief.</p>
                  </div>
                  <div className="ma-head__stats" aria-label="Scope">
                    <span><strong>{templates.length || "…"}</strong> templates</span>
                    <span><strong>{styles.length || "…"}</strong> styles</span>
                    <span><strong>{categories.length || "…"}</strong> formats</span>
                  </div>
                </header>
                <RecentStrip jobs={msJobs.slice(0, 6)} find={find} onOpen={(i) => setOpen({ list: msJobs.slice(0, 6), index: i })} onAll={() => go("generations")} waiting={waiting.length} />
                <TemplateExplorer
                  categories={categories}
                  styles={styles}
                  templates={templates}
                  filter={filter}
                  onFilter={(f) => setFilter((x) => ({ ...x, ...f }))}
                  activeId={styleId}
                  onUse={openTemplate}
                  loading={!data && !loadError}
                />
              </>
            )}

            {(view === "generations" || view === "favorites") && (
              <Results
                title={view === "generations" ? "My generations" : "Favourites"}
                jobs={view === "generations" ? msJobs : favJobs}
                find={find}
                favorites={favorites}
                onFavorite={(id) => setFavs((list) => (list.some((f) => f.id === id) ? list.filter((f) => f.id !== id) : [{ id }, ...list]))}
                onOpen={(list, index) => setOpen({ list, index })}
                onAdjust={applyRun}
                onAnimate={(id) => animate(id)}
                projects={projectsApi}
                onToProject={toProject}
                onStarted={started}
                errorText={errorText}
                waiting={view === "generations" ? waiting : []}
                chainErrors={view === "generations" ? chainErrors : []}
                empty={view === "generations"
                  ? { icon: <GStack />, text: "Nothing generated yet. Choose a template and your product photo on the left, or let the agent plan.", action: { label: "Plan campaign", run: () => go("agent") } }
                  : { icon: <GStar />, text: "No favourites yet. Mark results with the star." }}
              />
            )}

            {view === "project" && (project ? (
              <Results
                head={<ProjectHead project={project} api={projectsApi} onAll={() => go("projects")} count={projectJobs.length} />}
                title={project.name}
                jobs={projectJobs}
                find={find}
                favorites={favorites}
                onFavorite={(id) => setFavs((list) => (list.some((f) => f.id === id) ? list.filter((f) => f.id !== id) : [{ id }, ...list]))}
                onOpen={(list, index) => setOpen({ list, index })}
                onAdjust={applyRun}
                onAnimate={(id) => animate(id)}
                projects={projectsApi}
                onToProject={toProject}
                inProject={project.id}
                onRemoveFromProject={(id) => setProjects((list) => list.map((x) => (x.id === project.id ? withoutJob(x, id) : x)))}
                onStarted={started}
                errorText={errorText}
                waiting={waiting.filter((x) => x.projectId === project.id)}
                chainErrors={chainErrors.filter((x) => x.projectId === project.id)}
                empty={{ icon: <GFolder />, text: "Nothing in this project yet. Choose a template on the left and start; the result lands here. Finished generations join via “To project”." }}
              />
            ) : (
              <div className="empty">
                <GFolder />
                <p>{server === null ? "Loading projects …" : "This project no longer exists."}</p>
                <button type="button" className="btn" onClick={() => go("projects")}>All projects</button>
              </div>
            ))}
          </section>
        )}

        {view === "agent" && (
          <CampaignAgent
            find={find}
            products={products}
            product={product}
            productImage={productImage}
            onProduct={setProductId}
            onUpload={addUpload}
            onImport={addProduct}
            onManageProducts={() => go("products")}
            results={results}
            onResult={fromResult}
            avatar={c.avatar}
            onAvatar={(u) => patch({ avatar: u })}
            consent={c.consent}
            onConsent={(v) => patch({ consent: v })}
            onAdjust={applyRun}
            onStarted={started}
            errorText={errorText}
          />
        )}

        {view === "projects" && <ProjectsView api={projectsApi} />}

        {view === "products" && (
          <ProductLibrary
            products={products}
            onImport={addProduct}
            onUse={(id) => { setProductId(id); toHome(); }}
            onDelete={(id) => { setProducts((list) => list.filter((p) => p.id !== id)); if (productId === id) setProductId(null); }}
            onUpdate={(p) => setProducts((list) => list.map((x) => (x.id === p.id ? p : x)))}
            selected={productId}
            synced={Boolean(server && server !== "local")}
          />
        )}

        {view === "references" && (
          <ReferenceLibrary
            refs={refs}
            selected={c.adRef}
            styleTakesRef={Boolean(style?.adReference)}
            synced={Boolean(server && server !== "local")}
            onAdd={addRef}
            onUse={(url) => {
              patch({ adRef: url });
              if (!style?.adReference) {
                const first = styles.find((s) => s.category === "ads" && s.available);
                if (first) chooseStyle(first);
              }
              toHome();
            }}
            onDelete={(id) => setRefs((list) => list.filter((r) => r.id !== id))}
            onRename={(id, name) => setRefs((list) => list.map((r) => (r.id === id ? { ...r, name } : r)))}
          />
        )}
      </div>

      {toast && <div className="ma-toast" role="status">{toast}</div>}
      {styleOpen && (
        <StyleDialog
          categories={categories}
          styles={styles}
          templates={templates}
          current={styleId}
          category={category}
          onChoose={(s) => { chooseStyle(s); setStyleOpen(false); }}
          onClose={() => setStyleOpen(false)}
        />
      )}
      {dialogTemplate && (
        <TemplateDialog
          template={dialogTemplate}
          base={dialogTemplate.base ? find(dialogTemplate.base) ?? null : null}
          category={categories.find((x) => x.id === dialogTemplate.category)}
          more={moreTemplates(templates, dialogTemplate, 8)}
          onMore={switchTemplate}
          onEditor={() => {
            closeTemplate();
            // Phones: the builder sits above the templates.
            requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
          }}
          onClose={closeTemplate}
          state={c}
          onState={patch}
          products={products}
          product={product}
          productImage={productImage}
          onProduct={setProductId}
          onUpload={addUpload}
          onImport={addProduct}
          onManageProducts={() => go("products")}
          results={results}
          onResult={fromResult}
          onError={setError}
          error={error}
          missing={missing}
          price={price}
          priceState={priceState}
          balance={me?.credits ?? null}
          tooExpensive={tooExpensive}
          busy={busy}
          canGo={canGo}
          onGenerate={generate}
        />
      )}
      {open && <Lightbox jobs={open.list} index={open.index} onIndex={(i) => setOpen({ ...open, index: i })} onClose={() => setOpen(null)} />}
    </div>
  );
}
