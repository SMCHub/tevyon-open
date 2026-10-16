import type { Db } from "./postgres-repository";
import { TYPICAL_TURN, turnCostUsd, type TextModelDef } from "./text-models";

/**
 * What the Director's language models cost, per account. The Director is free to use within a daily budget in USD
 * (rolling 24 hours); strong models use it up faster. Nothing here reaches a client except shares and turn counts.
 */
export type UsageEntry = {
  accountId: string; modelId: string; costUsd: number; at: number;
  /** Credits the turn was paid with (strongest models); paid turns do not count against the free budget. */
  credits?: number;
};

export interface DirectorUsageStore {
  record(entry: UsageEntry): Promise<void>;
  /** USD the account's free turns (not paid with credits) cost since `since` (ms). */
  spentSince(accountId: string, since: number): Promise<number>;
}

export function createMemoryDirectorUsage(): DirectorUsageStore {
  const entries: UsageEntry[] = [];
  return {
    async record(entry) {
      entries.push({ ...entry });
    },
    async spentSince(accountId, since) {
      return entries.filter((e) => e.accountId === accountId && e.at >= since && !e.credits).reduce((sum, e) => sum + e.costUsd, 0);
    },
  };
}

export function createPostgresDirectorUsage(db: Db): DirectorUsageStore {
  return {
    async record(e) {
      await db.query("insert into director_usage (account_id, model_id, cost_usd, created_at, credits) values ($1, $2, $3, $4, $5)", [
        e.accountId, e.modelId, e.costUsd, new Date(e.at), e.credits ?? 0,
      ]);
    },
    async spentSince(accountId, since) {
      const rows = await db.query<{ spent: string | number }>(
        "select coalesce(sum(cost_usd), 0) as spent from director_usage where account_id = $1 and created_at >= $2 and credits = 0",
        [accountId, new Date(since)],
      );
      return Number(rows[0]?.spent ?? 0);
    },
  };
}

const DAY_MS = 86_400_000;

export type BudgetStatus = {
  /** A typical turn with this model still fits into today's budget. */
  allowed: boolean;
  /** Typical turns with this model the rest of today's budget allows. */
  turnsLeft: number;
  /** Share of today's budget that is left, 0 to 1. */
  share: number;
};

/**
 * The free daily budget, per account: `dailyUsd` decides how much an account gets (more once it has bought credits,
 * nothing while it owes credits). Turns paid with credits are recorded but do not use it up.
 */
export function createDirectorBudget(deps: { store: DirectorUsageStore; dailyUsd: (accountId: string) => number | Promise<number>; now?: () => number }) {
  const { store, now = Date.now } = deps;
  const left = async (accountId: string) => {
    const daily = await deps.dailyUsd(accountId);
    return { daily, left: Math.max(0, daily - (await store.spentSince(accountId, now() - DAY_MS))) };
  };
  const share = ({ daily, left: l }: { daily: number; left: number }) => (daily > 0 ? l / daily : 0);
  const turns = (left: number, model: TextModelDef) => {
    const turn = turnCostUsd(model, TYPICAL_TURN);
    return { allowed: left >= turn, turnsLeft: Math.floor(left / turn) };
  };
  return {
    async status(accountId: string, model: TextModelDef): Promise<BudgetStatus> {
      const b = await left(accountId);
      return { ...turns(b.left, model), share: share(b) };
    },
    /** Every model at once (model picker), from one look at the spending. */
    async statuses(accountId: string, models: TextModelDef[]) {
      const b = await left(accountId);
      return { share: share(b), models: Object.fromEntries(models.map((m) => [m.id, turns(b.left, m)])) };
    },
    async record(accountId: string, model: TextModelDef, costUsd: number, credits = 0) {
      await store.record({ accountId, modelId: model.id, costUsd, at: now(), ...(credits ? { credits } : {}) });
    },
  };
}
