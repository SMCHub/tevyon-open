import { describe, expect, it } from "vitest";
import { createCommunity, createMemoryCommunityStore, createPostgresCommunityStore, type CommunityStore, type PublishableJob } from "./community";
import { pgliteDb } from "./testing/repositories";

const LENA = "00000000-0000-4000-8000-00000000000a";
const MAX = "00000000-0000-4000-8000-00000000000b";
/** Other signed-in accounts that report. */
const R1 = "00000000-0000-4000-8000-0000000000c1";
const R2 = "00000000-0000-4000-8000-0000000000c2";
const R3 = "00000000-0000-4000-8000-0000000000c3";
const R4 = "00000000-0000-4000-8000-0000000000c4";
const R5 = "00000000-0000-4000-8000-0000000000c5";
const J1 = "10000000-0000-4000-8000-000000000001";
const J2 = "10000000-0000-4000-8000-000000000002";
const J3 = "10000000-0000-4000-8000-000000000003";
const J4 = "10000000-0000-4000-8000-000000000004";

const stores: [string, () => Promise<CommunityStore>][] = [
  ["memory", async () => createMemoryCommunityStore()],
  ["postgres", async () => createPostgresCommunityStore(await pgliteDb())],
];

/** A community over `store` with jobs kept in a map: the owner's own view of a job, like jobs.get(account, id). */
function setup(store: CommunityStore) {
  const jobs = new Map<string, PublishableJob & { accountId: string }>();
  let clock = Date.UTC(2026, 9, 15, 12);
  const community = createCommunity({
    store,
    job: async (accountId, jobId) => {
      const j = jobs.get(jobId);
      return j && j.accountId === accountId ? j : undefined;
    },
    now: () => (clock += 1000),
  });
  function addJob(accountId: string, id: string, over: Partial<PublishableJob> = {}) {
    jobs.set(id, {
      accountId, id, jobType: "flux_3_image", model: "Seedream 4.5", status: "succeeded",
      outputs: [{ url: `/api/media/${id}/0.png`, contentType: "image/png" }],
      params: { prompt: "A lighthouse at dawn", aspect_ratio: "16:9" },
      ...over,
    });
  }
  return { community, addJob };
}

describe.each(stores)("%s community", (_name, makeStore) => {
  it("shows a published creation in the community with its creator", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    expect(await community.saveProfile(LENA, { handle: "lena_creates", name: "Lena", acceptTerms: true })).toMatchObject({ ok: true });
    expect(await community.publish(LENA, J1)).toMatchObject({ ok: true });

    const feed = await community.feed();
    expect(feed.items).toEqual([
      expect.objectContaining({
        id: J1, kind: "image", jobType: "flux_3_image", model: "Seedream 4.5", prompt: "A lighthouse at dawn", aspect: "16:9",
        media: { url: `/api/media/${J1}/0.png`, contentType: "image/png" },
        creator: { handle: "lena_creates", name: "Lena", avatar: null },
      }),
    ]);
    expect(feed.next).toBeNull();
  });

  it("keeps creations private until their owner publishes them, and private again after unpublishing", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(LENA, J2);
    await community.saveProfile(LENA, { handle: "lena_creates", name: "Lena", acceptTerms: true });
    expect((await community.feed()).items).toEqual([]);

    await community.publish(LENA, J1);
    expect((await community.feed()).items.map((c) => c.id)).toEqual([J1]);

    expect(await community.unpublish(LENA, J1)).toEqual({ ok: true });
    expect((await community.feed()).items).toEqual([]);
  });

  it("publishes only the owner's own finished jobs", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(MAX, J1);
    addJob(LENA, J2, { status: "running", outputs: [] });
    addJob(LENA, J3, { status: "failed", outputs: [] });
    await community.saveProfile(LENA, { handle: "lena_creates", name: "Lena", acceptTerms: true });

    expect(await community.publish(LENA, J1)).toEqual({ ok: false, error: "not_found" });
    expect(await community.publish(LENA, J2)).toEqual({ ok: false, error: "not_ready" });
    expect(await community.publish(LENA, J3)).toEqual({ ok: false, error: "not_ready" });
    expect(await community.publish(LENA, "10000000-0000-4000-8000-0000000000ff")).toEqual({ ok: false, error: "not_found" });
    expect(await community.unpublish(LENA, J1)).toEqual({ ok: false, error: "not_found" });
    expect((await community.feed()).items).toEqual([]);
  });

  it("checks handle, name, bio and the community rules before it saves a profile", async () => {
    const { community } = setup(await makeStore());
    const save = (input: Record<string, unknown>) => community.saveProfile(LENA, { name: "Lena", acceptTerms: true, ...input });

    for (const handle of ["ab", "lena creates", "lena-creates", "123456", "___", "a".repeat(21), 42]) {
      expect(await save({ handle }), String(handle)).toEqual({ ok: false, error: "invalid_handle" });
    }
    for (const handle of ["admin", "support", "community", "tevyon_official", "the_tachyon"]) {
      expect(await save({ handle }), handle).toEqual({ ok: false, error: "reserved_handle" });
    }
    expect(await save({ handle: "lena", name: "  " })).toEqual({ ok: false, error: "invalid_name" });
    expect(await save({ handle: "lena", name: "L".repeat(41) })).toEqual({ ok: false, error: "invalid_name" });
    expect(await save({ handle: "lena", name: "Tevyon Support" })).toEqual({ ok: false, error: "reserved_name" });
    expect(await save({ handle: "lena", bio: "b".repeat(161) })).toEqual({ ok: false, error: "invalid_bio" });
    expect(await save({ handle: "lena", acceptTerms: false })).toEqual({ ok: false, error: "terms_required" });
    expect(await community.profile(LENA)).toBeNull();

    const saved = await save({ handle: " @Lena_Creates ", name: "  Lena   Smith ", bio: "Light,  water\nand film." });
    expect(saved).toEqual({ ok: true, profile: { handle: "lena_creates", name: "Lena Smith", bio: "Light, water and film.", showPrompts: true, since: expect.any(Number), avatar: null } });
    expect(await community.profile(LENA)).toEqual(saved.ok && saved.profile);
  });

  it("gives a handle to one account only and frees it when its owner changes it", async () => {
    const { community } = setup(await makeStore());
    expect(await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true })).toMatchObject({ ok: true });
    expect(await community.saveProfile(MAX, { handle: "LENA", name: "Max", acceptTerms: true })).toEqual({ ok: false, error: "handle_taken" });

    // The rules were accepted once; later changes keep that and the date the profile began.
    const first = await community.profile(LENA);
    expect(await community.saveProfile(LENA, { handle: "lena_new", name: "Lena", showPrompts: false })).toMatchObject({ ok: true });
    expect(await community.profile(LENA)).toEqual({ handle: "lena_new", name: "Lena", bio: "", showPrompts: false, since: first!.since, avatar: null });
    expect(await community.saveProfile(MAX, { handle: "lena", name: "Max", acceptTerms: true })).toMatchObject({ ok: true, profile: { handle: "lena" } });
  });

  it("shows others only the creation: never uploads, a preset's recipe prompt or the account behind it", async () => {
    const { community, addJob } = setup(await makeStore());
    const upload = `/api/media/uploads/${LENA}/photo.png`;
    addJob(LENA, J1, {
      jobType: "veo_3_1_lite", model: "Veo 3.1 Lite",
      outputs: [{ url: `/api/media/${J1}/0.mp4`, contentType: "video/mp4" }],
      params: {
        prompt: "SECRET RECIPE PROMPT", image: upload, aspect_ratio: "9:16", duration: 4, generate_audio: true,
        recipe: { id: "say-it", title: "Sag es!", wish: "Hallo Welt", inputs: { photo: upload } },
      },
    });
    addJob(LENA, J2, { params: { prompt: "Make @Bild1 glow", references: [upload], aspect_ratio: "1:1", resolution: "2K", seed: 7, negative_prompt: "blur" } });
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    expect(await community.publish(LENA, J1, { consent: true })).toMatchObject({ ok: true });
    expect(await community.publish(LENA, J2, { consent: true })).toMatchObject({ ok: true });

    const { items } = await community.feed();
    const preset = items.find((c) => c.id === J1);
    expect(preset).toMatchObject({
      kind: "video", prompt: null, aspect: "9:16", duration: 4, audio: true, preset: { id: "say-it", title: "Sag es!", wish: "Hallo Welt" },
    });
    expect(items.find((c) => c.id === J2)).toMatchObject({ kind: "image", prompt: "Make @Bild1 glow", aspect: "1:1", resolution: "2K" });
    const seen = JSON.stringify(items);
    for (const secret of ["/api/media/uploads/", LENA, "SECRET", '"inputs":', '"seed":', '"negative_prompt":', "blur", '"image":', '"references":']) {
      expect(seen, secret).not.toContain(secret);
    }
  });

  it("shows the prompt (and a preset's wish) only while its owner wants to", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(LENA, J2, { params: { prompt: "RECIPE", recipe: { id: "say-it", title: "Sag es!", wish: "Hallo Welt" } } });
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true, showPrompts: false });
    await community.publish(LENA, J1);
    await community.publish(LENA, J2);
    let items = (await community.feed()).items;
    expect(items.find((c) => c.id === J1)?.prompt).toBeNull();
    expect(items.find((c) => c.id === J2)?.preset).toEqual({ id: "say-it", title: "Sag es!" });

    // Publishing again changes what is shown, without moving the creation up in the feed.
    const before = items.find((c) => c.id === J1)!.publishedAt;
    expect(await community.publish(LENA, J1, { showPrompt: true })).toMatchObject({ ok: true, publication: { showPrompt: true } });
    items = (await community.feed()).items;
    expect(items.find((c) => c.id === J1)).toMatchObject({ prompt: "A lighthouse at dawn", publishedAt: before });
  });

  it("asks for consent before a creation made from an uploaded photo goes public", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1, { params: { prompt: "Animate", image: `/api/media/uploads/${LENA}/me.png` } });
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    expect(await community.publish(LENA, J1)).toEqual({ ok: false, error: "consent_required" });
    expect(await community.publish(LENA, J1, { consent: true })).toMatchObject({ ok: true });
    // Already public: changing what it shows asks no second time.
    expect(await community.publish(LENA, J1, { showPrompt: false })).toMatchObject({ ok: true });
  });

  it("pages through the community newest first and filters images and videos", async () => {
    const { community, addJob } = setup(await makeStore());
    const video = { outputs: [{ url: `/api/media/${J2}/0.mp4`, contentType: "video/mp4" }] };
    addJob(LENA, J1);
    addJob(LENA, J2, video);
    addJob(LENA, J3);
    addJob(MAX, J4);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    for (const [acc, id] of [[LENA, J1], [LENA, J2], [LENA, J3], [MAX, J4]] as const) await community.publish(acc, id);

    const first = await community.feed({ limit: 2 });
    expect(first.items.map((c) => c.id)).toEqual([J4, J3]);
    expect(first.next).toEqual(expect.any(String));
    const second = await community.feed({ limit: 2, before: first.next! });
    expect(second.items.map((c) => c.id)).toEqual([J2, J1]);
    expect(second.next).toBeNull();

    expect((await community.feed({ kind: "video" })).items.map((c) => c.id)).toEqual([J2]);
    expect((await community.feed({ kind: "image" })).items.map((c) => c.id)).toEqual([J4, J3, J1]);
    // A cursor that is not one of ours reads from the top.
    expect((await community.feed({ before: "x'; drop table jobs" })).items).toHaveLength(4);
  });

  it("shows a creator's page by handle, with only their public creations", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(LENA, J2, { outputs: [{ url: `/api/media/${J2}/0.mp4`, contentType: "video/mp4" }] });
    addJob(LENA, J3);
    addJob(MAX, J4);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", bio: "Light and film", acceptTerms: true });
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    await community.publish(LENA, J1);
    await community.publish(LENA, J2);
    await community.publish(MAX, J4);

    const page = await community.creator("@LENA");
    expect(page).toEqual({
      profile: { handle: "lena", name: "Lena", bio: "Light and film", since: expect.any(Number), avatar: null },
      counts: { image: 1, video: 1 },
      followers: 0,
      following: 0,
      items: [expect.objectContaining({ id: J2 }), expect.objectContaining({ id: J1 })],
      next: null,
    });
    expect(JSON.stringify(page)).not.toContain("showPrompts");
    expect((await community.creator("lena", { kind: "video" }))?.items.map((c) => c.id)).toEqual([J2]);
    expect(await community.creator("nobody")).toBeNull();
  });

  it("lists the owner's public creations and opens their media to others only while public", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(LENA, J2);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    expect(await community.isPublic(J1)).toBe(false);

    await community.publish(LENA, J1);
    await community.publish(LENA, J2, { showPrompt: false });
    expect(await community.mine(LENA)).toEqual([
      { jobId: J2, state: "public", showPrompt: false, publishedAt: expect.any(Number) },
      { jobId: J1, state: "public", showPrompt: true, publishedAt: expect.any(Number) },
    ]);
    expect(await community.isPublic(J1)).toBe(true);

    await community.unpublish(LENA, J1);
    expect((await community.mine(LENA)).map((p) => p.jobId)).toEqual([J2]);
    expect(await community.isPublic(J1)).toBe(false);
    expect(await community.mine(MAX)).toEqual([]);
  });

  it("opens exactly the published file to others, nothing else of the job", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1, { outputs: [{ url: `/api/media/${J1}/0.png`, contentType: "image/png" }, { url: `/api/media/${J1}/1.png`, contentType: "image/png" }] });
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    expect(await community.isPublicMedia(`${J1}/0.png`)).toBe(false);
    await community.publish(LENA, J1);
    expect(await community.isPublicMedia(`${J1}/0.png`)).toBe(true);
    expect(await community.isPublicMedia(`${J1}/1.png`)).toBe(false);
    expect(await community.isPublicMedia(`${J1}/../uploads/${LENA}/a.png`)).toBe(false);
    expect(await community.isPublicMedia("not-a-job/0.png")).toBe(false);
    await community.unpublish(LENA, J1);
    expect(await community.isPublicMedia(`${J1}/0.png`)).toBe(false);
  });

  it("hides a creation that three accounts report, until the operator looked at it", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.publish(LENA, J1);

    expect(await community.report(LENA, J1, { reason: "rights" })).toEqual({ ok: false, error: "own_creation" });
    expect(await community.report(R1, J1, { reason: "spam" })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await community.report(R1, J1, { reason: "rights", note: "My photo" })).toMatchObject({ ok: true });
    expect(await community.report(R1, J1, { reason: "rights" })).toMatchObject({ ok: true });
    expect(await community.report(R2, J1, { reason: "person" })).toMatchObject({ ok: true });
    expect(await community.isPublic(J1)).toBe(true);

    expect(await community.report(R3, J1, { reason: "other" })).toMatchObject({ ok: true });
    expect(await community.isPublic(J1)).toBe(false);
    expect((await community.feed()).items).toEqual([]);
    expect((await community.creator("lena"))?.counts).toEqual({ image: 0, video: 0 });
    expect(await community.mine(LENA)).toEqual([{ jobId: J1, state: "hidden", showPrompt: true, publishedAt: expect.any(Number), reason: "reports" }]);
    expect(await community.report(R4, J1, { reason: "other" })).toEqual({ ok: false, error: "not_found" });

    // Its owner can neither publish it again nor take the mark away by making it private first.
    expect(await community.publish(LENA, J1)).toEqual({ ok: false, error: "hidden" });
    await community.unpublish(LENA, J1);
    expect(await community.publish(LENA, J1)).toEqual({ ok: false, error: "hidden" });
    expect((await community.mine(LENA))[0]).toMatchObject({ state: "hidden" });

    // The operator restores it: the reports so far are settled, a new one alone hides nothing.
    expect(await community.unhide(J1)).toEqual({ ok: true });
    expect(await community.publish(LENA, J1)).toMatchObject({ ok: true });
    expect(await community.report(R4, J1, { reason: "other" })).toMatchObject({ ok: true });
    expect(await community.isPublic(J1)).toBe(true);
  });

  it("hides at once what is reported as involving minors, and what the operator takes down", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(LENA, J2);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.publish(LENA, J1);
    await community.publish(LENA, J2);

    await community.report(R1, J1, { reason: "minors" });
    expect(await community.isPublic(J1)).toBe(false);

    expect(await community.hide(J2, "Violates the usage policy: violence")).toEqual({ ok: true });
    expect(await community.isPublic(J2)).toBe(false);
    expect((await community.mine(LENA)).find((p) => p.jobId === J2)).toMatchObject({ state: "hidden", reason: "Violates the usage policy: violence" });
    expect(await community.hide("10000000-0000-4000-8000-0000000000ff", "x")).toEqual({ ok: false, error: "not_found" });
  });

  it("shows a chosen avatar under the handle, never the upload it came from", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    const own = `/api/media/uploads/${LENA}/face.webp`;
    const base = { handle: "lena", name: "Lena", acceptTerms: true };
    for (const avatar of [`/api/media/uploads/${MAX}/x.png`, "https://evil.example/x.png", `/api/media/${J1}/0.png`, `/api/media/uploads/${LENA}/../x.png`]) {
      expect(await community.saveProfile(LENA, { ...base, avatar }), avatar).toEqual({ ok: false, error: "invalid_avatar" });
    }
    const saved = await community.saveProfile(LENA, { ...base, avatar: own });
    const url = /^\/api\/community\/lena\/avatar\?v=\d+$/;
    expect(saved).toMatchObject({ ok: true, profile: { avatar: expect.stringMatching(url) } });
    await community.publish(LENA, J1);
    const { items } = await community.feed();
    expect(items[0]!.creator).toEqual({ handle: "lena", name: "Lena", avatar: expect.stringMatching(url) });
    expect(JSON.stringify(items)).not.toContain("/api/media/uploads/");
    expect(JSON.stringify(items)).not.toContain(LENA);
    expect(await community.avatarFile("lena")).toBe(`uploads/${LENA}/face.webp`);

    // A later change keeps the avatar; null removes it.
    await community.saveProfile(LENA, { handle: "lena", name: "Lena M." });
    expect((await community.profile(LENA))?.avatar).toMatch(url);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena M.", avatar: null });
    expect((await community.profile(LENA))?.avatar).toBeNull();
    expect(await community.avatarFile("lena")).toBeNull();
    expect(await community.avatarFile("nobody")).toBeNull();
  });

  it("counts one like per account, never your own, and shows each viewer what they liked", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(LENA, J2);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.publish(LENA, J1);

    expect(await community.like(R1, J2)).toEqual({ ok: false, error: "not_found" });
    expect(await community.like(LENA, J1)).toEqual({ ok: false, error: "own_creation" });
    expect(await community.like(R1, J1)).toEqual({ ok: true, liked: true, likes: 1 });
    expect(await community.like(R1, J1)).toEqual({ ok: true, liked: true, likes: 1 });
    expect(await community.like(R2, J1)).toEqual({ ok: true, liked: true, likes: 2 });

    expect((await community.feed({}, R1)).items[0]).toMatchObject({ id: J1, likes: 2, liked: true });
    expect((await community.feed({}, R3)).items[0]).toMatchObject({ likes: 2, liked: false });
    expect((await community.feed()).items[0]).not.toHaveProperty("liked");

    expect(await community.unlike(R1, J1)).toEqual({ ok: true, liked: false, likes: 1 });
    expect(await community.unlike(R1, J1)).toEqual({ ok: true, liked: false, likes: 1 });
    // Publishing again (another prompt choice) keeps the likes.
    await community.publish(LENA, J1, { showPrompt: false });
    expect((await community.feed()).items[0]!.likes).toBe(1);
  });

  it("lists the most liked first and pages through them", async () => {
    const { community, addJob } = setup(await makeStore());
    for (const id of [J1, J2, J3]) addJob(LENA, id);
    addJob(MAX, J4);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    for (const [acc, id] of [[LENA, J1], [LENA, J2], [LENA, J3], [MAX, J4]] as const) await community.publish(acc, id);
    for (const r of [R1, R2, R3]) await community.like(r, J2);
    for (const r of [R1, R2]) await community.like(r, J4);
    await community.like(R1, J1);

    const first = await community.feed({ sort: "popular", limit: 2 });
    expect(first.items.map((c) => [c.id, c.likes])).toEqual([[J2, 3], [J4, 2]]);
    const second = await community.feed({ sort: "popular", limit: 2, before: first.next! });
    expect(second.items.map((c) => c.id)).toEqual([J1, J3]);
    expect(second.next).toBeNull();
    // The newest stay the default.
    expect((await community.feed()).items.map((c) => c.id)).toEqual([J4, J3, J2, J1]);
  });

  it("lets accounts follow a creator, shows only how many, and lists what the followed creators share", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(MAX, J2);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    await community.publish(LENA, J1);
    await community.publish(MAX, J2);

    expect(await community.follow(LENA, "lena")).toEqual({ ok: false, error: "self" });
    expect(await community.follow(R1, "nobody")).toEqual({ ok: false, error: "not_found" });
    expect(await community.follow(R1, "@Lena")).toEqual({ ok: true, following: true, followers: 1 });
    expect(await community.follow(R1, "lena")).toEqual({ ok: true, following: true, followers: 1 });
    expect(await community.follow(R2, "lena")).toEqual({ ok: true, following: true, followers: 2 });
    expect(await community.follow(LENA, "max")).toEqual({ ok: true, following: true, followers: 1 });

    expect(await community.creator("lena", {}, R1)).toMatchObject({ followers: 2, following: 1, followed: true });
    expect(await community.creator("lena", {}, R3)).toMatchObject({ followed: false });
    expect(await community.creator("lena")).not.toHaveProperty("followed");

    // “Following”: only what the creators the viewer follows have shared; without a viewer nothing.
    expect((await community.feed({ following: true }, R1)).items.map((c) => c.id)).toEqual([J1]);
    expect((await community.feed({ following: true })).items).toEqual([]);

    expect(await community.unfollow(R1, "lena")).toEqual({ ok: true, following: false, followers: 1 });
    expect((await community.feed({ following: true }, R1)).items).toEqual([]);
  });

  it("says whether a report is the first since the operator looked and whether it hid the creation", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.publish(LENA, J1);
    expect(await community.report(R1, J1, { reason: "rights" })).toEqual({ ok: true, first: true, hidden: false });
    expect(await community.report(R1, J1, { reason: "rights" })).toEqual({ ok: true, first: false, hidden: false });
    expect(await community.report(R2, J1, { reason: "rights" })).toEqual({ ok: true, first: false, hidden: false });
    expect(await community.report(R3, J1, { reason: "rights" })).toEqual({ ok: true, first: false, hidden: true });

    // Restored, then a new report is a first again; “dismiss” settles reports without hiding anything.
    await community.unhide(J1);
    expect(await community.report(R4, J1, { reason: "other" })).toEqual({ ok: true, first: true, hidden: false });
    expect(await community.dismiss(J1)).toEqual({ ok: true });
    expect(await community.isPublic(J1)).toBe(true);
    expect(await community.report(R5, J1, { reason: "other" })).toEqual({ ok: true, first: true, hidden: false });
  });

  it("takes a reported profile out of the community only when the operator does, with everything on it", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true, avatar: `/api/media/uploads/${LENA}/a.png` });
    await community.publish(LENA, J1);

    expect(await community.reportProfile(LENA, "lena", { reason: "other" })).toEqual({ ok: false, error: "self" });
    expect(await community.reportProfile(R1, "nobody", { reason: "other" })).toEqual({ ok: false, error: "not_found" });
    expect(await community.reportProfile(R1, "lena", { reason: "nope" })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await community.reportProfile(R1, "lena", { reason: "person", note: "My face" })).toEqual({ ok: true, first: true });
    expect(await community.reportProfile(R2, "lena", { reason: "person" })).toEqual({ ok: true, first: false });
    expect(await community.isPublic(J1)).toBe(true);

    expect(await community.hideProfile("lena", "Fremdes Gesicht als Profilbild")).toEqual({ ok: true });
    expect(await community.creator("lena")).toBeNull();
    expect(await community.avatarFile("lena")).toBeNull();
    expect((await community.feed()).items).toEqual([]);
    expect(await community.isPublic(J1)).toBe(false);
    expect(await community.isPublicMedia(`${J1}/0.png`)).toBe(false);
    expect(await community.like(R1, J1)).toEqual({ ok: false, error: "not_found" });
    expect(await community.follow(R1, "lena")).toEqual({ ok: false, error: "not_found" });
    expect(await community.reportProfile(R3, "lena", { reason: "other" })).toEqual({ ok: false, error: "not_found" });
    // Its owner sees why, and may still change the profile; it stays out until the operator restores it.
    expect(await community.profile(LENA)).toMatchObject({ hidden: "Fremdes Gesicht als Profilbild" });
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", avatar: null });
    expect(await community.creator("lena")).toBeNull();

    expect(await community.unhideProfile("lena")).toEqual({ ok: true });
    expect(await community.profile(LENA)).not.toHaveProperty("hidden");
    expect((await community.feed()).items.map((c) => c.id)).toEqual([J1]);
    expect(await community.reportProfile(R3, "lena", { reason: "other" })).toEqual({ ok: true, first: true });
    expect(await community.dismissProfile("lena")).toEqual({ ok: true });
    expect(await community.reportProfile(R4, "lena", { reason: "other" })).toEqual({ ok: true, first: true });
    expect(await community.hideProfile("nobody", "x")).toEqual({ ok: false, error: "not_found" });
  });

  it("gives the operator the picture of a hidden profile, which nobody else gets any more", async () => {
    const { community } = setup(await makeStore());
    const pic = `/api/media/uploads/${MAX}/face.png`;
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true, avatar: pic });
    await community.hideProfile("max", "Fremdes Gesicht");
    expect(await community.avatarFile("max")).toBeNull();
    expect((await community.queue()).profiles).toEqual([expect.objectContaining({ handle: "max", avatar: pic, state: "hidden", reason: "Fremdes Gesicht" })]);
  });

  it("lists for the operator what waits, with reasons and notes, never who reported", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(LENA, J2);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    await community.publish(LENA, J1);
    await community.publish(LENA, J2);
    await community.report(R1, J1, { reason: "rights", note: "My picture" });
    await community.hide(J2, "Gewalt");
    await community.reportProfile(R2, "max", { reason: "person", note: "Fake" });

    const q = await community.queue();
    expect(q.creations).toEqual([
      { jobId: J2, handle: "lena", kind: "image", media: { url: `/api/media/${J2}/0.png`, contentType: "image/png" }, state: "hidden", reason: "Gewalt", reports: [] },
      {
        jobId: J1, handle: "lena", kind: "image", media: { url: `/api/media/${J1}/0.png`, contentType: "image/png" }, state: "public",
        reports: [{ reason: "rights", note: "My picture", at: expect.any(Number) }],
      },
    ]);
    expect(q.profiles).toEqual([{ handle: "max", name: "Max", avatar: null, state: "visible", reports: [{ reason: "person", note: "Fake", at: expect.any(Number) }] }]);
    for (const who of [R1, R2]) expect(JSON.stringify(q)).not.toContain(who);

    await community.dismiss(J1);
    await community.dismissProfile("max");
    const after = await community.queue();
    expect(after.creations.map((c) => c.jobId)).toEqual([J2]);
    expect(after.profiles).toEqual([]);
  });

  it("tells its owner how many follow them and how many likes their public creations have", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(LENA, J2);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    await community.publish(LENA, J1);
    await community.publish(LENA, J2);
    await community.like(R1, J1);
    await community.like(R2, J1);
    await community.like(R1, J2);
    await community.follow(R1, "lena");
    await community.follow(R2, "lena");
    await community.follow(LENA, "max");
    expect(await community.stats(LENA)).toEqual({ followers: 2, following: 1, likes: 3 });
    expect(await community.stats(R3)).toEqual({ followers: 0, following: 0, likes: 0 });
  });

  it("deletes a profile with what it shares, but keeps what moderation took out", async () => {
    const { community, addJob } = setup(await makeStore());
    for (const id of [J1, J2, J3]) addJob(LENA, id);
    addJob(MAX, J4);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    for (const [acc, id] of [[LENA, J1], [LENA, J2], [LENA, J3], [MAX, J4]] as const) await community.publish(acc, id);
    await community.hide(J3, "Gewalt");
    await community.like(R1, J1);
    await community.follow(R1, "lena");
    await community.report(R1, J2, { reason: "other" });

    expect(await community.deleteProfile(LENA)).toEqual({ ok: true });
    expect(await community.profile(LENA)).toBeNull();
    expect(await community.creator("lena")).toBeNull();
    expect((await community.feed()).items.map((c) => c.id)).toEqual([J4]);
    expect((await community.mine(LENA)).map((p) => [p.jobId, p.state])).toEqual([[J3, "hidden"]]);
    expect((await community.queue()).creations.map((c) => c.jobId)).toEqual([J3]);

    // The handle is free again; a new profile starts without followers and cannot bring the hidden creation back.
    expect(await community.saveProfile(LENA, { handle: "lena", name: "Lena" })).toEqual({ ok: false, error: "terms_required" });
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    expect(await community.creator("lena")).toMatchObject({ followers: 0, counts: { image: 0, video: 0 } });
    expect(await community.publish(LENA, J3)).toEqual({ ok: false, error: "hidden" });
    expect(await community.deleteProfile(R3)).toEqual({ ok: true });
  });

  it("forgets an account completely: profile, creations, likes, follows and reports, given and received", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    addJob(MAX, J4);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    await community.publish(LENA, J1);
    await community.publish(MAX, J4);
    await community.like(LENA, J4);
    await community.like(R1, J1);
    await community.follow(LENA, "max");
    await community.follow(R1, "lena");
    await community.report(LENA, J4, { reason: "other" });
    await community.reportProfile(LENA, "max", { reason: "other" });
    await community.reportProfile(R1, "lena", { reason: "other" });

    await community.forgetAccount(LENA);
    expect(await community.profile(LENA)).toBeNull();
    expect(await community.mine(LENA)).toEqual([]);
    expect((await community.feed()).items.map((c) => [c.id, c.likes])).toEqual([[J4, 0]]);
    expect(await community.creator("max")).toMatchObject({ followers: 0 });
    expect(await community.stats(R1)).toMatchObject({ following: 0 });
    expect(await community.queue()).toEqual({ creations: [], profiles: [] });
  });

  it("needs a profile before anything of an account goes public", async () => {
    const { community, addJob } = setup(await makeStore());
    addJob(LENA, J1);
    expect(await community.publish(LENA, J1)).toEqual({ ok: false, error: "profile_required" });
    expect((await community.feed()).items).toEqual([]);
  });
});
