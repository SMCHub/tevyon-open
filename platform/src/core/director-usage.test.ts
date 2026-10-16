import { describe, expect, it } from "vitest";
import { createDirectorBudget, createMemoryDirectorUsage, createPostgresDirectorUsage, type DirectorUsageStore } from "./director-usage";
import { textModel } from "./text-models";
import { pgliteDb } from "./testing/repositories";

const ACC = "00000000-0000-4000-8000-0000000000d1";
const OTHER = "00000000-0000-4000-8000-0000000000d2";
const T0 = Date.parse("2026-10-13T08:00:00Z");
const HOUR = 3_600_000;

const stores: [string, () => Promise<DirectorUsageStore>][] = [
  ["memory", async () => createMemoryDirectorUsage()],
  ["postgres", async () => createPostgresDirectorUsage(await pgliteDb())],
];

describe.each(stores)("%s Director usage", (_name, makeStore) => {
  it("adds up what an account's turns cost since a point in time", async () => {
    const store = await makeStore();
    await store.record({ accountId: ACC, modelId: "claude-sonnet-5-5", costUsd: 0.01, at: T0 });
    await store.record({ accountId: ACC, modelId: "claude-fable-5-1", costUsd: 0.02, at: T0 + HOUR });
    await store.record({ accountId: OTHER, modelId: "claude-fable-5-1", costUsd: 0.05, at: T0 + HOUR });

    expect(await store.spentSince(ACC, T0)).toBeCloseTo(0.03, 9);
    expect(await store.spentSince(ACC, T0 + 1)).toBeCloseTo(0.02, 9);
  });

  it("lets turns run while the daily budget lasts and points to a cheaper model when it does not", async () => {
    const store = await makeStore();
    let now = T0;
    const budget = createDirectorBudget({ store, dailyUsd: () => 0.05, now: () => now });
    const sonnet = textModel("claude-sonnet-5-5")!; // typical turn $0.014
    const fable = textModel("claude-fable-5-1")!; // typical turn $0.07
    const haiku = textModel("claude-haiku-5-5")!; // typical turn $0.0007

    expect(await budget.status(ACC, fable)).toMatchObject({ allowed: false, turnsLeft: 0, share: 1 });
    expect(await budget.status(ACC, sonnet)).toMatchObject({ allowed: true, turnsLeft: 3 });

    await budget.record(ACC, sonnet, 0.04);
    expect(await budget.status(ACC, sonnet)).toMatchObject({ allowed: false });
    expect(await budget.status(ACC, haiku)).toMatchObject({ allowed: true, turnsLeft: 14 });
    expect((await budget.status(ACC, haiku)).share).toBeCloseTo(0.2, 9);

    now = T0 + 25 * HOUR;
    expect(await budget.status(ACC, sonnet)).toMatchObject({ allowed: true, share: 1 });
  });

  it("reports every model at once for the model picker", async () => {
    const store = await makeStore();
    const budget = createDirectorBudget({ store, dailyUsd: () => 0.05, now: () => T0 });
    await budget.record(ACC, textModel("claude-sonnet-5-5")!, 0.04);

    const all = await budget.statuses(ACC, [textModel("claude-fable-5-1")!, textModel("claude-haiku-5-5")!]);

    expect(all.share).toBeCloseTo(0.2, 9);
    expect(all.models).toEqual({
      "claude-fable-5-1": { allowed: false, turnsLeft: 0 },
      "claude-haiku-5-5": { allowed: true, turnsLeft: 14 },
    });
  });

  it("gives each account its own daily budget and leaves messages paid with credits out of it", async () => {
    const store = await makeStore();
    const budget = createDirectorBudget({ store, dailyUsd: (accountId) => (accountId === ACC ? 0.25 : 0.05), now: () => T0 });
    const sonnet = textModel("claude-sonnet-5-5")!;

    await budget.record(ACC, textModel("claude-fable-5-1")!, 0.2, 16);
    await budget.record(OTHER, sonnet, 0.02);

    expect(await budget.status(ACC, sonnet)).toMatchObject({ allowed: true, share: 1 });
    expect((await budget.status(OTHER, sonnet)).share).toBeCloseTo(0.6, 9);
  });
});
