import os from "node:os";
import path from "node:path";
import { after } from "next/server";
import { labelAiOutput } from "@/core/ai-label";
import type { Availability } from "@/core/availability";
import { catalog } from "@/core/catalog";
import { createConsent, createMemoryConsentStore, createPostgresConsentStore } from "@/core/consent";
import { createJobs } from "@/core/jobs";
import { createPostgresRepository } from "@/core/postgres-repository";
import { createComfyProvider } from "@/core/providers/comfy";
import { createPrompting } from "@/core/prompting";
import { createMemoryRepository } from "@/core/repository";
import { defineSkills } from "@/core/skills";
import { createMemoryWebhookStore, createPostgresWebhookStore, createWebhooks } from "@/core/webhooks";
import { comfyKey, routerBase } from "./comfy";
import { createPgDb } from "./db";
import { createDemoProvider } from "./demo-provider";
import { createFileMediaStore } from "./file-media";
import { mediaLinks } from "./media-links";
import { createChatPromptWriter } from "./prompt-writer";
import { postPublic } from "./remote-image";
import { loadSkills, SKILLS_DIR } from "./skill-files";
import { createSupabaseMediaStore } from "./supabase-media";
import { webhookSecret } from "./webhook-secret";

const TICK_MS = 2000;
/** On Vercel the file system is read-only and an instance may freeze after its response (no timers to rely on). */
const ON_VERCEL = Boolean(process.env.VERCEL);

/**
 * Where uploads and results live: Supabase Storage (bucket «media») on Vercel or with MEDIA_STORE=supabase, otherwise
 * the file store in .data/media (local development). Both use the same keys and /api/media URLs.
 */
export function mediaStore() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const wanted = process.env.MEDIA_STORE ?? (ON_VERCEL ? "supabase" : "file");
  if (wanted === "supabase" && url && secretKey) return createSupabaseMediaStore({ url, secretKey });
  return createFileMediaStore(path.join(process.cwd(), ".data/media"));
}

/** Every model of the register is live; the open version has no model sync (a model leaves by its register entry). */
const allActive = (_jobType: string): Availability => ({ ok: true, status: "active" });

function build() {
  const dbUrl = process.env.DATABASE_URL;
  const db = dbUrl ? createPgDb(dbUrl) : undefined;
  const repo = db ? createPostgresRepository(db) : createMemoryRepository();
  const media = mediaStore();
  const key = comfyKey();
  const providers = {
    // The Comfy Router: one key, every model of the register. Our uploads go inline (localhost is not reachable).
    comfy: key
      ? createComfyProvider({ apiKey: key, baseUrl: routerBase(), loadMedia: (url) => media.read(url.replace(/^\/api\/media\//, "")) })
      : createDemoProvider(),
  };
  // No generation without a prompt skill: defineSkills throws at boot if a catalog model has none.
  const skillFiles = loadSkills(SKILLS_DIR);
  const skills = defineSkills(skillFiles.skills, catalog);
  const writer = key ? createChatPromptWriter({ apiKey: key, model: process.env.PROMPT_WRITER_MODEL }) : undefined;
  const prompting = createPrompting({ register: catalog, skills, writer });
  const models = { availability: allActive };
  // The worker gets every new job at once (no wait for the next timer pass); see the timer below. On Vercel a pass runs
  // inside the request with after(): tick() waits until its jobs moved on, so the instance stays alive for it.
  // Webhooks of finished jobs go out in the same beat as the worker (core/webhooks.ts).
  const deliver = () => webhooks.dispatch().catch((e) => console.error("[webhooks]", e));
  const wake = () => {
    if (ON_VERCEL) {
      try {
        return after(() => jobs.tick().catch((e) => console.error("[worker]", e)).then(deliver));
      } catch {
        // Outside a request (timer): fall through to the fire-and-forget pass.
      }
    }
    void jobs.pump().catch((e) => console.error("[worker]", e)).then(deliver);
  };
  // Consents a person confirmed for jobs that show real people, when an agent starts them (core/consent.ts).
  const consent = createConsent({ store: db ? createPostgresConsentStore(db) : createMemoryConsentStore() });
  const jobs = createJobs({
    register: catalog, repo, providers, media, prompting, availability: models.availability, consent,
    // Every stored result carries the machine-readable AI label (core/ai-label.ts); C2PA files stay untouched.
    label: labelAiOutput,
    log: (e) => console.warn(`[jobs] ${e.jobId} failed: ${e.error}${e.detail ? ` – ${e.detail}` : ""}`),
    warn: (m) => console.warn(`[worker] ${m}`),
    onQueued: wake,
    // One name per server in the database claims: host and port, so a restarted server takes its own jobs back at
    // once instead of waiting for its old claims to run out (two servers never share a port).
    worker: { id: process.env.WORKER_ID ?? `${os.hostname()}:${process.env.PORT ?? process.pid}` },
  });
  const webhooks = createWebhooks({
    store: db ? createPostgresWebhookStore(db) : createMemoryWebhookStore(),
    getJob: (accountId, jobId) => jobs.get(accountId, jobId),
    secretFor: (accountId) => webhookSecret(accountId) ?? "",
    link: (url, base) => {
      try {
        return mediaLinks().sign(url, base);
      } catch {
        return new URL(url, base).toString();
      }
    },
    send: (url, body, headers) => postPublic(url, body, headers),
  });

  // Worker in the web process: a pass every 2 s checks running jobs and retries; pump() hands jobs to the router and
  // never waits for one. With more than one process, the claim in the database keeps a job from going out twice.
  setInterval(wake, TICK_MS).unref?.();

  // nudge(): routes that clients poll (job list, MCP) move running jobs on; on Vercel that is the only worker beat.
  const nudge = () => (ON_VERCEL ? wake() : undefined);
  return { jobs, repo, media, skills, skillFiles, models, nudge, consent, webhooks, live: Boolean(key), persistent: Boolean(dbUrl) };
}

type Runtime = ReturnType<typeof build>;
const g = globalThis as unknown as { __tevyonOpen?: Runtime };

/** One in-process runtime per server (survives hot reload). */
export async function runtime(): Promise<Runtime> {
  return (g.__tevyonOpen ??= build());
}
