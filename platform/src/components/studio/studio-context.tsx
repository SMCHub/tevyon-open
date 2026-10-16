"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JsonSchema } from "./schema";

export type Kind = "image" | "video";
export type CatalogEntry = {
  jobType: string; kind: Kind; model: string; tagline: string; badge: "neu" | "top" | null; params: JsonSchema;
  /** Lifecycle from /api/catalog: paused models take no jobs, deprecated ones retire at retiresAt. */
  status?: "active" | "deprecated" | "paused";
  /** Model family ("veo", "wan" …): a new model without its own cover shows its family's cover. */
  family?: string;
};
export type Job = {
  id: string;
  jobType: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed";
  credits: number;
  outputs: { url: string; contentType: string }[];
  error?: string;
  params: Record<string, unknown>;
  createdAt: number;
};
export type Me = { email: string | null; credits: number; demo: boolean };
/** started: jobs of this request that did start before the error; credits: the current price on price_changed. */
export type StartResult = { ok: true; ids: string[] } | { ok: false; error: string; started: number; credits?: number };

type Studio = {
  catalog: CatalogEntry[];
  me: Me | null;
  jobs: Job[];
  loaded: boolean;
  /** A visitor without a login on a public page (community, a creator's page): no account, no jobs, no polling. */
  guest: boolean;
  kindOf: (jobType: string) => Kind | undefined;
  refresh: () => Promise<void>;
  quote: (jobType: string, params: Record<string, unknown>) => Promise<number | null>;
  /**
   * Starts `count` independent jobs (each with its own idempotency key). maxCredits is the price per job the user saw:
   * if the server's price is higher, nothing more starts (price_changed).
   */
  start: (jobType: string, params: Record<string, unknown>, count?: number, opts?: { maxCredits?: number }) => Promise<StartResult>;
};

const Ctx = createContext<Studio | null>(null);

export function useStudio() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStudio outside StudioProvider");
  return s;
}

/** Pages open without a login (proxy.ts PUBLIC): the community and creators' pages, not the own /profile. */
const PUBLIC_PAGES = /^\/(?:community(?:\/|$)|profile\/[^/]+)/;

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [guest, setGuest] = useState(false);

  useEffect(() => {
    fetch("/api/catalog").then((r) => r.json()).then((d: { jobTypes: CatalogEntry[] }) => setCatalog(d.jobTypes));
  }, []);

  const refresh = useCallback(async () => {
    const [j, m] = await Promise.all([fetch("/api/jobs"), fetch("/api/me")]);
    if (j.status === 401 || m.status === 401) {
      // On a public page a visitor without a login stays; everywhere else the login comes first.
      if (PUBLIC_PAGES.test(window.location.pathname)) {
        setGuest(true);
        setMe(null);
        setJobs([]);
        setLoaded(true);
        return;
      }
      router.replace("/login");
      return;
    }
    setGuest(false);
    setJobs((await j.json()).jobs);
    setMe(await m.json());
    setLoaded(true);
  }, [router]);

  // Poll fast while something is generating, slowly otherwise.
  const busy = jobs.some((j) => j.status === "queued" || j.status === "running");
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    // A guest has nothing to poll; after a login the page loads anew.
    if (guest) return;
    latest.current();
    const t = setInterval(() => latest.current(), busy ? 2000 : 15000);
    return () => clearInterval(t);
  }, [busy, guest]);

  const quote = useCallback(async (jobType: string, params: Record<string, unknown>) => {
    const r = await fetch("/api/quote", { method: "POST", body: JSON.stringify({ jobType, params }) });
    const q = (await r.json()) as { ok: boolean; credits?: number };
    return q.ok ? q.credits! : null;
  }, []);

  const start = useCallback(
    async (jobType: string, params: Record<string, unknown>, count = 1, opts: { maxCredits?: number } = {}): Promise<StartResult> => {
      // All at once: the server writes the prompt once for identical starts, so «Anzahl 4» is about as fast as one.
      // Each start keeps its own idempotency key and price; the reservation is atomic, so with too few credits exactly
      // as many start as are paid for.
      type Res = { ok: boolean; error?: string; credits?: number; job?: { id: string } };
      const results = await Promise.all(
        Array.from({ length: count }, async (): Promise<Res> => {
          try {
            const r = await fetch(`/api/jobs/${jobType}`, {
              method: "POST",
              headers: { "Idempotency-Key": crypto.randomUUID() },
              body: JSON.stringify({ params, ...(opts.maxCredits !== undefined ? { maxCredits: opts.maxCredits } : {}) }),
            });
            return (await r.json()) as Res;
          } catch {
            return { ok: false, error: "unknown" };
          }
        }),
      );
      await refresh();
      const ids = results.flatMap((r) => (r.ok && r.job ? [r.job.id] : []));
      const failed = results.find((r) => !r.ok);
      if (!failed) return { ok: true, ids };
      return { ok: false, error: failed.error ?? "unknown", started: ids.length, ...(typeof failed.credits === "number" ? { credits: failed.credits } : {}) };
    },
    [refresh],
  );

  const kindOf = useCallback((jobType: string) => catalog.find((c) => c.jobType === jobType)?.kind, [catalog]);

  const value = useMemo(
    () => ({ catalog, me, jobs, loaded, guest, kindOf, refresh, quote, start }),
    [catalog, me, jobs, loaded, guest, kindOf, refresh, quote, start],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
