import { describe, expect, it } from "vitest";
import { CONSENT_TTL_MS, createConsent, createMemoryConsentStore, createPostgresConsentStore, type ConsentStore } from "./consent";
import { pgliteDb } from "./testing/repositories";

const LENA = "00000000-0000-4000-8000-00000000000a";
const MAX = "00000000-0000-4000-8000-00000000000b";
const JOB = "10000000-0000-4000-8000-000000000001";
const TARGET = `/api/media/uploads/${LENA}/target.png`;
const FACE = `/api/media/uploads/${LENA}/face.png`;
const OTHER = `/api/media/uploads/${LENA}/other.png`;

const stores: [string, () => Promise<ConsentStore>][] = [
  ["memory", async () => createMemoryConsentStore()],
  ["postgres", async () => createPostgresConsentStore(await pgliteDb())],
];

function setup(store: ConsentStore) {
  let clock = Date.UTC(2026, 9, 15, 20);
  const consent = createConsent({ store, now: () => clock });
  return { consent, later: (ms: number) => (clock += ms) };
}

describe.each(stores)("%s consent", (_name, makeStore) => {
  it("lets one job with exactly the confirmed pictures start once", async () => {
    const { consent } = setup(await makeStore());
    const req = await consent.request(LENA, "face_swap", [TARGET, FACE]);
    expect(req).toMatchObject({ ok: true, id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    const id = (req as { id: string }).id;

    // Before the person confirmed, nothing starts.
    expect(await consent.check(LENA, id, "face_swap", [TARGET, FACE])).toEqual({ ok: false, error: "consent_pending" });
    expect(await consent.view(LENA, id)).toMatchObject({ jobType: "face_swap", images: [TARGET, FACE], state: "pending" });

    expect(await consent.confirm(LENA, id)).toEqual({ ok: true });
    expect(await consent.check(LENA, id, "face_swap", [TARGET, FACE])).toEqual({ ok: true });
    // Other pictures, another job type or another account: not this consent.
    expect(await consent.check(LENA, id, "face_swap", [TARGET, OTHER])).toEqual({ ok: false, error: "consent_invalid" });
    expect(await consent.check(LENA, id, "character_swap", [TARGET, FACE])).toEqual({ ok: false, error: "consent_invalid" });
    expect(await consent.check(MAX, id, "face_swap", [TARGET, FACE])).toEqual({ ok: false, error: "consent_invalid" });

    expect(await consent.use(id, JOB)).toBe(true);
    expect(await consent.use(id, JOB)).toBe(false);
    expect(await consent.check(LENA, id, "face_swap", [TARGET, FACE])).toEqual({ ok: false, error: "consent_used" });
    expect(await consent.view(LENA, id)).toMatchObject({ state: "used" });
  });

  it("gives a consent back when its job did not start, but only for that job", async () => {
    const { consent } = setup(await makeStore());
    const id = ((await consent.request(LENA, "face_swap", [TARGET, FACE])) as { id: string }).id;
    await consent.confirm(LENA, id);
    expect(await consent.use(id, JOB)).toBe(true);
    await consent.release(id, "00000000-0000-4000-8000-0000000000ff"); // another job: no effect
    expect(await consent.check(LENA, id, "face_swap", [TARGET, FACE])).toEqual({ ok: false, error: "consent_used" });
    await consent.release(id, JOB);
    expect(await consent.check(LENA, id, "face_swap", [TARGET, FACE])).toEqual({ ok: true });
  });

  it("is only for the account that asked, which confirms or declines it while it is open", async () => {
    const { consent } = setup(await makeStore());
    const id = ((await consent.request(LENA, "character_swap", [TARGET, FACE])) as { id: string }).id;
    expect(await consent.view(MAX, id)).toBeUndefined();
    expect(await consent.confirm(MAX, id)).toEqual({ ok: false, error: "not_found" });
    expect(await consent.decline(LENA, id)).toEqual({ ok: true });
    expect(await consent.confirm(LENA, id)).toEqual({ ok: false, error: "declined" });
    expect(await consent.check(LENA, id, "character_swap", [TARGET, FACE])).toEqual({ ok: false, error: "consent_declined" });
    expect(await consent.view(LENA, id)).toMatchObject({ state: "declined" });
  });

  it("runs out: an open or confirmed consent that was not used in time starts nothing", async () => {
    const { consent, later } = setup(await makeStore());
    const open = ((await consent.request(LENA, "face_swap", [TARGET, FACE])) as { id: string }).id;
    const confirmed = ((await consent.request(LENA, "face_swap", [TARGET, FACE])) as { id: string }).id;
    await consent.confirm(LENA, confirmed);
    later(CONSENT_TTL_MS + 1);
    expect(await consent.confirm(LENA, open)).toEqual({ ok: false, error: "expired" });
    expect(await consent.check(LENA, confirmed, "face_swap", [TARGET, FACE])).toEqual({ ok: false, error: "consent_expired" });
    expect(await consent.view(LENA, open)).toMatchObject({ state: "expired" });
  });

  it("needs pictures to bind to, and knows nothing of an unknown id", async () => {
    const { consent } = setup(await makeStore());
    expect(await consent.request(LENA, "face_swap", [])).toEqual({ ok: false, error: "invalid_params" });
    expect(await consent.check(LENA, "00000000-0000-4000-8000-0000000000ff", "face_swap", [TARGET, FACE])).toEqual({ ok: false, error: "consent_invalid" });
    expect(await consent.check(LENA, "not-a-uuid", "face_swap", [TARGET, FACE])).toEqual({ ok: false, error: "consent_invalid" });
  });
});
