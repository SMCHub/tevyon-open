import type { Db } from "./postgres-repository";
import { PLANS, type PlanId } from "./pricing";

/**
 * Monthly plans (Abo) as the payment provider reports them. The credits of a month come from its paid invoice
 * (billing.ts “fulfilPlanInvoice”); this record only says which plan an account has, until when, and who the customer
 * is at the provider (for the customer portal). Server-only.
 */
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "paused";

export type SubscriptionRecord = {
  /** The provider's subscription id (Stripe sub_…). */
  id: string;
  accountId: string;
  /** The provider's customer (Stripe cus_…): one per account, the customer portal opens with it. */
  customerId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  /** End of the month that is paid (ms). */
  currentPeriodEnd?: number;
  /** Cancelled: runs until currentPeriodEnd, then ends. */
  cancelAtPeriodEnd: boolean;
  /** When the provider sent this state (ms). Older states never overwrite newer ones: events can arrive out of order. */
  eventAt: number;
};

/** States in which an account has a plan it pays or still has to pay for: no second checkout then. */
const LIVE: readonly SubscriptionStatus[] = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];

export const isLive = (s: Pick<SubscriptionRecord, "status">) => LIVE.includes(s.status);
export const isPlanId = (id: unknown): id is PlanId => PLANS.some((p) => p.id === id);

/** The subscription that counts for an account: a live one first, else the latest. */
export function currentSubscription(list: SubscriptionRecord[]): SubscriptionRecord | undefined {
  const byNewest = [...list].sort((a, b) => b.eventAt - a.eventAt);
  return byNewest.find(isLive) ?? byNewest[0];
}

export interface SubscriptionStore {
  /** Writes the state unless a newer one is stored. Returns whether it was written. */
  upsert(s: SubscriptionRecord): Promise<boolean>;
  /** The account's subscriptions, newest first. */
  ofAccount(accountId: string): Promise<SubscriptionRecord[]>;
}

export function createMemorySubscriptions(): SubscriptionStore {
  const rows = new Map<string, SubscriptionRecord>();
  return {
    async upsert(s) {
      const old = rows.get(s.id);
      if (old && old.eventAt > s.eventAt) return false;
      rows.set(s.id, { ...s });
      return true;
    },
    async ofAccount(accountId) {
      return [...rows.values()].filter((r) => r.accountId === accountId).sort((a, b) => b.eventAt - a.eventAt).map((r) => ({ ...r }));
    },
  };
}

type Row = {
  id: string; account_id: string; customer_id: string; plan_id: string; status: SubscriptionStatus;
  current_period_end: Date | string | null; cancel_at_period_end: boolean; event_at: Date | string;
};

export function createPostgresSubscriptions(db: Db): SubscriptionStore {
  return {
    async upsert(s) {
      // One statement: a state older than the stored one leaves the row as it is.
      const rows = await db.query(
        `insert into subscriptions (id, account_id, customer_id, plan_id, status, current_period_end, cancel_at_period_end, event_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set customer_id = excluded.customer_id, plan_id = excluded.plan_id, status = excluded.status,
           current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
           event_at = excluded.event_at, updated_at = now()
         where subscriptions.event_at <= excluded.event_at
         returning id`,
        [s.id, s.accountId, s.customerId, s.planId, s.status, s.currentPeriodEnd ? new Date(s.currentPeriodEnd) : null, s.cancelAtPeriodEnd, new Date(s.eventAt)],
      );
      return rows.length > 0;
    },
    async ofAccount(accountId) {
      const rows = await db.query<Row>("select * from subscriptions where account_id = $1 order by event_at desc, id", [accountId]);
      return rows.filter((r) => isPlanId(r.plan_id)).map((r) => ({
        id: r.id, accountId: r.account_id, customerId: r.customer_id, planId: r.plan_id as PlanId, status: r.status,
        ...(r.current_period_end ? { currentPeriodEnd: new Date(r.current_period_end).getTime() } : {}),
        cancelAtPeriodEnd: r.cancel_at_period_end, eventAt: new Date(r.event_at).getTime(),
      }));
    },
  };
}
