import { describe, expect, it } from "vitest";
import { createCommunity, createPostgresCommunityStore, type PublishableJob } from "../core/community";
import { pgliteDb } from "../core/testing/repositories";
import { run } from "./community-cli";
import { REASON_LABEL } from "./notify";

const LENA = "00000000-0000-4000-8000-00000000000a";
const MAX = "00000000-0000-4000-8000-00000000000b";
const J1 = "10000000-0000-4000-8000-000000000001";
const J2 = "10000000-0000-4000-8000-000000000002";

/** The operator's CLI on its own database (never DATABASE_URL), with two accounts as Supabase keeps them (auth.users). */
async function setup() {
  const db = await pgliteDb();
  await db.query("create schema auth");
  await db.query("create table auth.users (id uuid primary key, email text)");
  await db.query("insert into auth.users (id, email) values ($1, 'lena@example.com'), ($2, 'max@example.com')", [LENA, MAX]);
  const jobs = new Map<string, PublishableJob & { accountId: string }>();
  const community = createCommunity({
    store: createPostgresCommunityStore(db),
    job: async (accountId, jobId) => {
      const j = jobs.get(jobId);
      return j && j.accountId === accountId ? j : undefined;
    },
  });
  const addJob = (accountId: string, id: string) =>
    jobs.set(id, {
      accountId, id, jobType: "flux_3_image", model: "Seedream 4.5", status: "succeeded",
      outputs: [{ url: `/api/media/${id}/0.png`, contentType: "image/png" }], params: { prompt: "A lighthouse", aspect_ratio: "1:1" },
    });
  const out: string[] = [];
  const cli = (...argv: string[]) => run(argv, db, (line) => out.push(line));
  return { community, addJob, out, cli };
}

describe("community cli", () => {
  it("forgets everything an account put into the community, but only with --yes", async () => {
    const { community, addJob, out, cli } = await setup();
    addJob(LENA, J1);
    addJob(MAX, J2);
    await community.saveProfile(LENA, { handle: "lena", name: "Lena", acceptTerms: true });
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    await community.publish(LENA, J1);
    await community.publish(MAX, J2);
    await community.like(LENA, J2);
    await community.follow(LENA, "max");

    expect(await cli("forget", "LENA@example.com")).toBe(0);
    expect(out.join("\n")).toMatch(/@lena/);
    expect(out.join("\n")).toMatch(/Nothing changed/);
    expect(await community.profile(LENA)).not.toBeNull();

    expect(await cli("forget", "lena@example.com", "--yes")).toBe(0);
    expect(await community.profile(LENA)).toBeNull();
    expect((await community.feed()).items.map((c) => [c.id, c.likes])).toEqual([[J2, 0]]);
    expect(await community.creator("max")).toMatchObject({ followers: 0 });
  });

  it("finds no account behind an unknown address and changes nothing", async () => {
    const { out, cli } = await setup();
    expect(await cli("forget", "nobody@example.com", "--yes")).toBe(1);
    expect(out.join("\n")).toMatch(/No account/);
  });

  it("lists reported profiles, never who reported, and hides and restores one by its handle", async () => {
    const { community, out, cli } = await setup();
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    await community.reportProfile(LENA, "max", { reason: "person", note: "Fake" });

    expect(await cli("list")).toBe(0);
    expect(out.join("\n")).toMatch(/@max/);
    expect(out.join("\n")).toContain(REASON_LABEL.person);
    expect(out.join("\n")).toMatch(/Fake/);
    expect(out.join("\n")).not.toContain(LENA);

    expect(await cli("hide", "@max", "Stolen", "face")).toBe(0);
    expect(await community.creator("max")).not.toBeNull();
    expect(await cli("hide", "@max", "Stolen", "face", "--yes")).toBe(0);
    expect(await community.creator("max")).toBeNull();
    expect(await community.profile(MAX)).toMatchObject({ hidden: "Stolen face" });

    expect(await cli("unhide", "@max", "--yes")).toBe(0);
    expect(await community.creator("max")).not.toBeNull();
  });

  it("hides a creation by its job id", async () => {
    const { community, addJob, cli } = await setup();
    addJob(MAX, J2);
    await community.saveProfile(MAX, { handle: "max", name: "Max", acceptTerms: true });
    await community.publish(MAX, J2);
    expect(await cli("hide", J2, "Violence", "--yes")).toBe(0);
    expect((await community.feed()).items).toEqual([]);
    expect(await cli("hide", "10000000-0000-4000-8000-0000000000ff", "x", "--yes")).toBe(1);
  });
});
