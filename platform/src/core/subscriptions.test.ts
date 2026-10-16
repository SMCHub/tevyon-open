import { describe, expect, it } from "vitest";
import { createMemorySubscriptions, createPostgresSubscriptions, currentSubscription, type SubscriptionRecord, type SubscriptionStore } from "./subscriptions";
import { pgliteDb } from "./testing/repositories";

const ACC = "00000000-0000-4000-8000-0000000000f1";
const T = Date.parse("2026-10-15T10:00:00Z");
const sub = (changes: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  id: "sub_1", accountId: ACC, customerId: "cus_1", planId: "monat-5000", status: "active", currentPeriodEnd: T + 30 * 86_400_000,
  cancelAtPeriodEnd: false, eventAt: T, ...changes,
});

const stores: [string, () => Promise<SubscriptionStore>][] = [
  ["memory", async () => createMemorySubscriptions()],
  ["postgres", async () => createPostgresSubscriptions(await pgliteDb())],
];

describe.each(stores)("%s subscription store", (_name, makeStore) => {
  it("keeps the newest state when the provider's events arrive out of order", async () => {
    const store = await makeStore();

    expect(await store.upsert(sub({ status: "past_due", eventAt: T + 2_000 }))).toBe(true);
    expect(await store.upsert(sub({ status: "active", eventAt: T + 1_000 }))).toBe(false);

    expect(await store.ofAccount(ACC)).toEqual([sub({ status: "past_due", eventAt: T + 2_000 })]);
  });

  it("follows a plan switch and a cancellation", async () => {
    const store = await makeStore();
    await store.upsert(sub());
    await store.upsert(sub({ planId: "monat-12000", eventAt: T + 1_000 }));
    await store.upsert(sub({ planId: "monat-12000", cancelAtPeriodEnd: true, eventAt: T + 2_000 }));

    expect(await store.ofAccount(ACC)).toMatchObject([{ planId: "monat-12000", cancelAtPeriodEnd: true }]);
  });

  it("lists an account's subscriptions newest first, and the live one counts", async () => {
    const store = await makeStore();
    await store.upsert(sub({ id: "sub_old", status: "canceled", eventAt: T + 5_000 }));
    await store.upsert(sub({ id: "sub_new", status: "active", eventAt: T + 1_000 }));

    const list = await store.ofAccount(ACC);
    expect(list.map((s) => s.id)).toEqual(["sub_old", "sub_new"]);
    expect(currentSubscription(list)?.id).toBe("sub_new");
  });
});
