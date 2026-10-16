import { createCommunity, createPostgresCommunityStore } from "../core/community";
import type { Db } from "../core/postgres-repository";
import { createPgDb } from "./db";
import { REASON_LABEL } from "./notify";

const USAGE = [
  "Usage:  node --env-file=.env.local scripts/community.ts list",
  "        node --env-file=.env.local scripts/community.ts hide <job-id|@handle> <reason> [--yes]",
  "        node --env-file=.env.local scripts/community.ts unhide <job-id|@handle> [--yes]",
  "        node --env-file=.env.local scripts/community.ts forget <email> [--yes]",
].join("\n");

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Zurich" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Community moderation for the operator (scripts/community.ts), the same decisions as /moderation:
 * - list: creations and profiles with reports since the last review, and everything hidden, with reasons and notes
 * - hide: takes a creation (job id) or a profile (@handle) out of the community; its owner reads the reason
 * - unhide: restores it; the reports so far count as settled
 * - forget: deletes everything an account put into the community (profile, publications, likes, follows, reports),
 *   for a deletion request under the DSG
 * Without --yes, hide, unhide and forget only show what they would do. `db`: the database to work on (tests: PGlite).
 */
export async function run(argv: string[], db: Db, log: (line: string) => void = console.log): Promise<number> {
  const yes = argv.includes("--yes");
  const [command, target, ...rest] = argv.filter((a) => a !== "--yes");
  const community = createCommunity({ store: createPostgresCommunityStore(db), job: async () => undefined });

  if (command === "list") {
    const { creations, profiles } = await community.queue();
    if (!creations.length && !profiles.length) {
      log("Nothing to review: no open reports, nothing hidden.");
      return 0;
    }
    const state = (s: string, reason?: string) => (s === "hidden" ? `HIDDEN (${reason === "reports" ? "after reports" : reason})` : s === "public" || s === "visible" ? "visible" : "private");
    const reports = (list: { reason: string; note: string; at: number }[]) => {
      for (const r of list) log(`  ${DATE.format(r.at)}  ${REASON_LABEL[r.reason] ?? r.reason}${r.note ? `: “${r.note}”` : ""}`);
    };
    for (const c of creations) {
      log(`${c.jobId}  @${c.handle ?? "?"}  ${c.kind === "video" ? "Video" : "Image"}  ${state(c.state, c.reason)}  ${plural(c.reports.length, "report", "reports")}`);
      reports(c.reports);
      log(`  File: ${c.media.url}`);
    }
    for (const p of profiles) {
      log(`@${p.handle}  ${p.name}  Profile  ${state(p.state, p.reason)}  ${plural(p.reports.length, "report", "reports")}`);
      reports(p.reports);
    }
    return 0;
  }

  if (command === "forget") {
    if (!target) return usage(log);
    const [user] = await db.query<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [target]);
    if (!user) {
      log(`No account with the email ${target}.`);
      return 1;
    }
    const [profile, mine, stats] = await Promise.all([community.profile(user.id), community.mine(user.id), community.stats(user.id)]);
    log(`Account ${target} (${user.id}): ${profile ? `profile @${profile.handle}` : "no profile"}, ${plural(mine.length, "publication", "publications")}, follows ${stats.following}, ${plural(stats.followers, "follower", "followers")}.`);
    log("Deletes all of it from the Community, plus the account's likes, follows and reports. Account, jobs and files stay.");
    if (!yes) {
      log("Nothing changed. Run with --yes.");
      return 0;
    }
    await community.forgetAccount(user.id);
    log("Done.");
    return 0;
  }

  if (command !== "hide" && command !== "unhide") return usage(log);
  const reason = rest.join(" ").trim();
  if (!target || (command === "hide" && !reason)) return usage(log);
  const handle = target.startsWith("@") ? target.slice(1).toLowerCase() : null;
  const what = handle ? `the profile @${handle}` : `the creation ${target}`;
  log(command === "hide" ? `Hide: ${what}, reason “${reason}”` : `Restore: ${what}`);
  if (!yes) {
    log("Nothing changed. Run with --yes.");
    return 0;
  }
  const res = handle
    ? command === "hide" ? await community.hideProfile(handle, reason) : await community.unhideProfile(handle)
    : command === "hide" ? await community.hide(target, reason) : await community.unhide(target);
  log(res.ok ? "Done." : "Not found.");
  return res.ok ? 0 : 1;
}

function usage(log: (line: string) => void) {
  log(USAGE);
  return 1;
}

/** scripts/community.ts: works on DATABASE_URL. */
export async function main(argv: string[]): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL is missing.");
    return 1;
  }
  const db = createPgDb(url);
  try {
    return await run(argv, db);
  } finally {
    await db.pool.end();
  }
}
