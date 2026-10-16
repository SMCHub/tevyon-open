import type { Db } from "./postgres-repository";

/**
 * Consent for jobs that show real people (Face Swap, Character Swap) when an agent starts them over the API, MCP or the
 * CLI. A checkbox an agent ticks itself proves nothing, so a person signed in to Tevyon confirms on /consent/<id> that
 * they hold the rights to the images and the consent of everyone shown. A confirmation is bound to the account, the job
 * type and exactly these images, runs out after CONSENT_TTL_MS and starts one job. In the Studio the person ticks the
 * box themselves; no grant is needed there (jobs.ts).
 */

/** How long a request stays open and a confirmation usable. */
export const CONSENT_TTL_MS = 2 * 60 * 60 * 1000;

export type ConsentGrant = {
  id: string;
  accountId: string;
  jobType: string;
  /** The pictures the job will show, in the order of the job's parameters (target, then the new face or person). */
  images: string[];
  createdAt: number;
  expiresAt: number;
  confirmedAt: number | null;
  declinedAt: number | null;
  usedAt: number | null;
  jobId: string | null;
};

export type ConsentState = "pending" | "confirmed" | "declined" | "used" | "expired";
export type ConsentView = { id: string; jobType: string; images: string[]; state: ConsentState; expiresAt: number };
export type ConsentCheck =
  | { ok: true }
  | { ok: false; error: "consent_required" | "consent_invalid" | "consent_pending" | "consent_declined" | "consent_used" | "consent_expired" };

export interface ConsentStore {
  insert(g: ConsentGrant): Promise<void>;
  get(id: string): Promise<ConsentGrant | undefined>;
  /** Marks an open grant confirmed or declined; false when it was no longer open. */
  decide(id: string, decision: "confirmed" | "declined", at: number): Promise<boolean>;
  /** Marks a confirmed, unused grant as used by a job; false when it was used already (or never confirmed). */
  use(id: string, jobId: string, at: number): Promise<boolean>;
  /** Makes a grant usable again when the job that took it never started. Only for that job. */
  release(id: string, jobId: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stateOf(g: ConsentGrant, now: number): ConsentState {
  if (g.usedAt !== null) return "used";
  if (g.declinedAt !== null) return "declined";
  if (now > g.expiresAt) return "expired";
  return g.confirmedAt !== null ? "confirmed" : "pending";
}

const sameImages = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function createConsent(deps: { store: ConsentStore; now?: () => number; newId?: () => string }) {
  const { store, now = Date.now, newId = () => crypto.randomUUID() } = deps;

  /** A grant of this account, or nothing (another account's id is as unknown as a wrong one). */
  async function own(accountId: string, id: string): Promise<ConsentGrant | undefined> {
    if (!UUID.test(id)) return undefined;
    const g = await store.get(id);
    return g && g.accountId === accountId ? g : undefined;
  }

  /** Opens a request for a job with these pictures; the person confirms it on /consent/<id>. */
  async function request(accountId: string, jobType: string, images: string[]): Promise<{ ok: true; id: string; expiresAt: number } | { ok: false; error: "invalid_params" }> {
    if (!images.length || images.some((i) => typeof i !== "string" || !i)) return { ok: false, error: "invalid_params" };
    const at = now();
    const g: ConsentGrant = {
      id: newId(), accountId, jobType, images: [...images], createdAt: at, expiresAt: at + CONSENT_TTL_MS,
      confirmedAt: null, declinedAt: null, usedAt: null, jobId: null,
    };
    await store.insert(g);
    return { ok: true, id: g.id, expiresAt: g.expiresAt };
  }

  /** What the confirmation page shows its owner. */
  async function view(accountId: string, id: string): Promise<ConsentView | undefined> {
    const g = await own(accountId, id);
    return g && { id: g.id, jobType: g.jobType, images: g.images, state: stateOf(g, now()), expiresAt: g.expiresAt };
  }

  async function decide(accountId: string, id: string, decision: "confirmed" | "declined"): Promise<{ ok: true } | { ok: false; error: "not_found" | "expired" | "declined" | "confirmed" | "used" }> {
    const g = await own(accountId, id);
    if (!g) return { ok: false, error: "not_found" };
    const state = stateOf(g, now());
    if (state !== "pending") return { ok: false, error: state };
    return (await store.decide(id, decision, now())) ? { ok: true } : { ok: false, error: "not_found" };
  }

  /** Whether this consent lets this account start this job with these pictures now. */
  async function check(accountId: string, id: string | undefined, jobType: string, images: string[]): Promise<ConsentCheck> {
    if (!id) return { ok: false, error: "consent_required" };
    const g = await own(accountId, id);
    if (!g || g.jobType !== jobType || !sameImages(g.images, images)) return { ok: false, error: "consent_invalid" };
    const state = stateOf(g, now());
    if (state === "confirmed") return { ok: true };
    return { ok: false, error: `consent_${state}` as "consent_pending" | "consent_declined" | "consent_used" | "consent_expired" };
  }

  return {
    request,
    view,
    confirm: (accountId: string, id: string) => decide(accountId, id, "confirmed"),
    decline: (accountId: string, id: string) => decide(accountId, id, "declined"),
    check,
    /** The job that used a confirmed consent; a consent starts one job only. */
    use: (id: string, jobId: string) => store.use(id, jobId, now()),
    /** Gives the consent back when that job was refused after all (no credits, key limit, database error). */
    release: (id: string, jobId: string) => store.release(id, jobId),
  };
}

export type Consent = ReturnType<typeof createConsent>;

export function createMemoryConsentStore(): ConsentStore {
  const grants = new Map<string, ConsentGrant>();
  return {
    async insert(g) {
      grants.set(g.id, { ...g, images: [...g.images] });
    },
    async get(id) {
      const g = grants.get(id);
      return g && { ...g, images: [...g.images] };
    },
    async decide(id, decision, at) {
      const g = grants.get(id);
      if (!g || g.confirmedAt !== null || g.declinedAt !== null) return false;
      grants.set(id, decision === "confirmed" ? { ...g, confirmedAt: at } : { ...g, declinedAt: at });
      return true;
    },
    async use(id, jobId, at) {
      const g = grants.get(id);
      if (!g || g.confirmedAt === null || g.usedAt !== null) return false;
      grants.set(id, { ...g, usedAt: at, jobId });
      return true;
    },
    async release(id, jobId) {
      const g = grants.get(id);
      if (g && g.jobId === jobId) grants.set(id, { ...g, usedAt: null, jobId: null });
    },
  };
}

export function createPostgresConsentStore(db: Db): ConsentStore {
  type Row = {
    id: string; account_id: string; job_type: string; images: string[]; created_at: Date; expires_at: Date;
    confirmed_at: Date | null; declined_at: Date | null; used_at: Date | null; job_id: string | null;
  };
  const ms = (d: Date | null) => (d === null ? null : new Date(d).getTime());
  return {
    async insert(g) {
      await db.query(
        `insert into consent_grants (id, account_id, job_type, images, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)`,
        [g.id, g.accountId, g.jobType, g.images, new Date(g.createdAt), new Date(g.expiresAt)],
      );
    },
    async get(id) {
      const [r] = await db.query<Row>("select * from consent_grants where id = $1", [id]);
      return r && {
        id: r.id, accountId: r.account_id, jobType: r.job_type, images: r.images, createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!,
        confirmedAt: ms(r.confirmed_at), declinedAt: ms(r.declined_at), usedAt: ms(r.used_at), jobId: r.job_id,
      };
    },
    async decide(id, decision, at) {
      const column = decision === "confirmed" ? "confirmed_at" : "declined_at";
      const rows = await db.query(
        `update consent_grants set ${column} = $2 where id = $1 and confirmed_at is null and declined_at is null returning id`,
        [id, new Date(at)],
      );
      return rows.length === 1;
    },
    async use(id, jobId, at) {
      // One statement: two starts at once never both get the same consent.
      const rows = await db.query(
        "update consent_grants set used_at = $3, job_id = $2 where id = $1 and confirmed_at is not null and used_at is null returning id",
        [id, jobId, new Date(at)],
      );
      return rows.length === 1;
    },
    async release(id, jobId) {
      await db.query("update consent_grants set used_at = null, job_id = null where id = $1 and job_id = $2", [id, jobId]);
    },
  };
}
