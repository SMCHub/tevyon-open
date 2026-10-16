import { createHash } from "node:crypto";
import type { DebitRecord, GrantRecord, JobOrigin, JobRecord, JobRepository } from "./repository";

/**
 * Account statement (Kontoauszug): every credit movement of an account with the running balance.
 * It is read from the bookings themselves (grants and jobs), so it cannot disagree with what was charged.
 * One line per job: reserved while it runs, charged when it succeeds, refunded (net zero) when it fails.
 * Only Tachyon terms leave this module: no grant refs, no provider details.
 */
export type GrantSource = "welcome" | "purchase" | "subscription" | "adjustment";
export type JobCharge = "reserved" | "charged" | "refunded";
/** A purchase whose payment went back (refund, dispute), and a dispute that was won (booked back). */
export type ReversalSource = "refund" | "dispute" | "dispute_won";

type EntryBase = {
  id: string;
  at: number;
  /** Change of the available balance (negative while a job holds or has spent credits). */
  credits: number;
  /** Available balance right after this entry. */
  balance: number;
};

export type CreditEntry =
  | (EntryBase & { kind: "grant"; source: GrantSource })
  | (EntryBase & {
      kind: "job";
      jobId: string;
      jobType: string;
      model: string;
      state: JobCharge;
      /** The job's price. */
      amount: number;
      /** Where the job was started: Studio, MCP, CLI or another API client. */
      origin: JobOrigin;
    })
  /** A Director message with one of the strongest models: reserved at its cap while it runs, then charged at its cost. */
  | (EntryBase & { kind: "director"; model: string; state: JobCharge; amount: number })
  /** Credits of a purchase taken back after a refund or dispute (the full amount: the balance shows what is owed). */
  | (EntryBase & { kind: "reversal"; source: ReversalSource })
  /** Plan credits that were left when their period ended: they lapse. */
  | (EntryBase & { kind: "expiry" });

export type CreditSummary = {
  /** Spendable now. */
  available: number;
  /** Held by queued and running jobs. */
  reserved: number;
  /** Charged for finished jobs. */
  spent: number;
  /** Given back for failed jobs. */
  refunded: number;
  /** All credits ever granted. */
  granted: number;
  /** Taken back for refunded or disputed purchases (a won dispute gives them back). */
  debited: number;
  /** Still owed from those: the next credits pay it first. */
  owed: number;
  /** Plan credits that lapsed unused at the end of their period. */
  expired: number;
};

export type CreditStatement = {
  summary: CreditSummary;
  entries: CreditEntry[];
  /** Plan credits still running (part of `available`) and when the first of them ends; null without any. */
  expiring: { credits: number; at: number } | null;
};

/**
 * Grant refs follow a prefix convention: welcome:<account>, stripe… for purchases, sub:<invoice> for the monthly credits
 * of a plan (Abo), anything else is a manual adjustment.
 */
export function grantSource(ref: string): GrantSource {
  if (ref.startsWith("welcome:")) return "welcome";
  if (ref.startsWith("stripe")) return "purchase";
  if (ref.startsWith("sub:")) return "subscription";
  return "adjustment";
}

/**
 * Whether the account paid: a pack or a plan that did not go back in full (refunds and lost disputes take back what was
 * paid; a won dispute is void). Paying accounts get the bigger Director budget and the strongest models.
 */
export function hasPaid(grants: Pick<GrantRecord, "ref" | "credits">[], debits: Pick<DebitRecord, "kind" | "state" | "credits">[]) {
  const paid = grants.filter((g) => ["purchase", "subscription"].includes(grantSource(g.ref))).reduce((n, g) => n + g.credits, 0);
  const back = debits.filter((d) => (d.kind === "refund" || d.kind === "dispute") && d.state !== "void").reduce((n, d) => n + d.credits, 0);
  return paid > back;
}

/** Stable, opaque ID for a grant entry; the ref itself stays on the server. */
const grantId = (g: GrantRecord) => `g_${createHash("sha256").update(g.ref).digest("hex").slice(0, 16)}`;

function charge(job: JobRecord): JobCharge {
  if (job.status === "succeeded") return "charged";
  if (job.status === "failed") return "refunded";
  return "reserved";
}

type Event = { at: number; order: number; id: string; entry: (balance: number) => CreditEntry; delta: number };

const debitId = (d: DebitRecord) => `d_${createHash("sha256").update(d.ref).digest("hex").slice(0, 16)}`;

export function createCredits(repo: Pick<JobRepository, "grants" | "list" | "debits">, opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;

  async function statement(accountId: string): Promise<CreditStatement> {
    const [grants, jobs, debits] = await Promise.all([repo.grants(accountId), repo.list(accountId), repo.debits(accountId)]);
    const summary: CreditSummary = { available: 0, reserved: 0, spent: 0, refunded: 0, granted: 0, debited: 0, owed: 0, expired: 0 };
    const at = now();
    let expiring = null as CreditStatement["expiring"];

    const events: Event[] = [];
    for (const g of grants) {
      summary.granted += g.credits;
      const id = grantId(g);
      events.push({ at: g.createdAt, order: 0, id, delta: g.credits, entry: (balance) => ({ id, kind: "grant", at: g.createdAt, credits: g.credits, balance, source: grantSource(g.ref) }) });
      if (g.expiresAt === undefined || !g.remaining) continue;
      if (g.expiresAt > at) {
        expiring = { credits: (expiring?.credits ?? 0) + g.remaining, at: Math.min(expiring?.at ?? Infinity, g.expiresAt) };
        continue;
      }
      // What was left at the end of the period lapsed then; the repository never changes it afterwards.
      const lapsed = g.remaining;
      summary.expired += lapsed;
      const end = g.expiresAt;
      events.push({ at: end, order: 4, id: `${id}_x`, delta: -lapsed, entry: (balance) => ({ id: `${id}_x`, kind: "expiry", at: end, credits: -lapsed, balance }) });
    }
    for (const j of jobs) {
      const state = charge(j);
      if (state === "reserved") summary.reserved += j.credits;
      else if (state === "charged") summary.spent += j.credits;
      else summary.refunded += j.credits;
      const delta = state === "refunded" ? 0 : -j.credits;
      const id = `j_${j.id}`;
      events.push({
        at: j.createdAt, order: 1, id, delta,
        entry: (balance) => ({
          id, kind: "job", at: j.createdAt, credits: delta, balance,
          jobId: j.id, jobType: j.jobType, model: j.model, state, amount: j.credits, origin: j.origin ?? "web",
        }),
      });
    }

    for (const d of debits) {
      const id = debitId(d);
      if (d.kind === "director") {
        const state: JobCharge = d.state === "held" ? "reserved" : d.state === "settled" ? "charged" : "refunded";
        if (state === "reserved") summary.reserved += d.credits;
        else if (state === "charged") summary.spent += d.credits;
        else summary.refunded += d.credits;
        const delta = state === "refunded" ? 0 : -d.credits;
        events.push({
          at: d.createdAt, order: 2, id, delta,
          entry: (balance) => ({ id, kind: "director", at: d.createdAt, credits: delta, balance, model: d.model ?? "Director", state, amount: d.credits }),
        });
        continue;
      }
      // The full amount goes out at once, so the running balance shows a debt below zero until grants pay it.
      const source: ReversalSource = d.kind === "refund" ? "refund" : "dispute";
      events.push({
        at: d.createdAt, order: 2, id, delta: -d.credits,
        entry: (balance) => ({ id, kind: "reversal", at: d.createdAt, credits: -d.credits, balance, source }),
      });
      if (d.state === "void") {
        const back = `${id}_w`;
        events.push({
          at: d.updatedAt, order: 3, id: back, delta: d.credits,
          entry: (balance) => ({ id: back, kind: "reversal", at: d.updatedAt, credits: d.credits, balance, source: "dispute_won" }),
        });
      } else {
        summary.debited += d.credits;
        summary.owed += d.credits - d.collected;
      }
    }

    // Oldest first for the running balance (grants before jobs at the same instant), newest first for reading.
    events.sort((a, b) => a.at - b.at || a.order - b.order || a.id.localeCompare(b.id));
    let balance = 0;
    const entries = events.map((e) => e.entry((balance += e.delta)));
    // What is owed shows as a balance below zero; spendable is never less than nothing.
    summary.available = balance + summary.owed;
    return { summary, entries: entries.reverse(), expiring };
  }

  return { statement };
}
