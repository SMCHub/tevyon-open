import { createCommunity, createPostgresCommunityStore } from "../core/community";
import type { Db } from "../core/postgres-repository";
import { createPgDb } from "./db";
import { REASON_LABEL } from "./notify";

const USAGE = [
  "Aufruf: node --env-file=.env.local scripts/community.ts list",
  "        node --env-file=.env.local scripts/community.ts hide <job-id|@handle> <grund> [--yes]",
  "        node --env-file=.env.local scripts/community.ts unhide <job-id|@handle> [--yes]",
  "        node --env-file=.env.local scripts/community.ts forget <e-mail> [--yes]",
].join("\n");

const DATE = new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Zurich" });
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
      log("Nichts zu prüfen: keine offenen Meldungen, nichts ausgeblendet.");
      return 0;
    }
    const state = (s: string, reason?: string) => (s === "hidden" ? `AUSGEBLENDET (${reason === "reports" ? "nach Meldungen" : reason})` : s === "public" || s === "visible" ? "sichtbar" : "privat");
    const reports = (list: { reason: string; note: string; at: number }[]) => {
      for (const r of list) log(`  ${DATE.format(r.at)}  ${REASON_LABEL[r.reason] ?? r.reason}${r.note ? `: «${r.note}»` : ""}`);
    };
    for (const c of creations) {
      log(`${c.jobId}  @${c.handle ?? "?"}  ${c.kind === "video" ? "Video" : "Bild"}  ${state(c.state, c.reason)}  ${plural(c.reports.length, "Meldung", "Meldungen")}`);
      reports(c.reports);
      log(`  Datei: ${c.media.url}`);
    }
    for (const p of profiles) {
      log(`@${p.handle}  ${p.name}  Profil  ${state(p.state, p.reason)}  ${plural(p.reports.length, "Meldung", "Meldungen")}`);
      reports(p.reports);
    }
    return 0;
  }

  if (command === "forget") {
    if (!target) return usage(log);
    const [user] = await db.query<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [target]);
    if (!user) {
      log(`Kein Konto mit der E-Mail ${target}.`);
      return 1;
    }
    const [profile, mine, stats] = await Promise.all([community.profile(user.id), community.mine(user.id), community.stats(user.id)]);
    log(`Konto ${target} (${user.id}): ${profile ? `Profil @${profile.handle}` : "kein Profil"}, ${plural(mine.length, "Veröffentlichung", "Veröffentlichungen")}, folgt ${stats.following}, ${plural(stats.followers, "Follower", "Follower")}.`);
    log("Löscht alles davon in der Community, dazu die Likes, Follows und Meldungen des Kontos. Konto, Jobs und Dateien bleiben.");
    if (!yes) {
      log("Nichts geändert. Mit --yes ausführen.");
      return 0;
    }
    await community.forgetAccount(user.id);
    log("Erledigt.");
    return 0;
  }

  if (command !== "hide" && command !== "unhide") return usage(log);
  const reason = rest.join(" ").trim();
  if (!target || (command === "hide" && !reason)) return usage(log);
  const handle = target.startsWith("@") ? target.slice(1).toLowerCase() : null;
  const what = handle ? `das Profil @${handle}` : `die Kreation ${target}`;
  log(command === "hide" ? `Ausblenden: ${what}, Grund «${reason}»` : `Wiederherstellen: ${what}`);
  if (!yes) {
    log("Nichts geändert. Mit --yes ausführen.");
    return 0;
  }
  const res = handle
    ? command === "hide" ? await community.hideProfile(handle, reason) : await community.unhideProfile(handle)
    : command === "hide" ? await community.hide(target, reason) : await community.unhide(target);
  log(res.ok ? "Erledigt." : "Nicht gefunden.");
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
    console.log("DATABASE_URL fehlt.");
    return 1;
  }
  const db = createPgDb(url);
  try {
    return await run(argv, db);
  } finally {
    await db.pool.end();
  }
}
