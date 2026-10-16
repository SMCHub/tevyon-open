import { adminGrant } from "../core/admin-grant";
import { createPostgresRepository } from "../core/postgres-repository";
import { createPgDb } from "./db";

/**
 * Manual credit grant for an account (scripts/grant-credits.ts). Without --yes it shows account, amount and ref and
 * books nothing; with --yes it books through repo.grant (idempotent over the ref) and prints the new balance.
 */
export async function main(argv: string[]): Promise<number> {
  const [email, amount, ...rest] = argv.filter((a) => a !== "--yes");
  const reason = rest.join(" ");
  if (!email || !amount || !reason) {
    console.log("Usage: node --env-file=.env.local scripts/grant-credits.ts <email> <credits> <reason> [--yes]");
    return 1;
  }
  const check = adminGrant("-", Number(amount), reason, new Date());
  if (!check.ok) {
    console.log(check.error === "credits_out_of_range" ? "Credits: a whole number from 1 to 5000." : "Reason missing (at least one word).");
    return 1;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL is missing.");
    return 1;
  }
  const db = createPgDb(url);
  try {
    const [user] = await db.query<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [email]);
    if (!user) {
      console.log(`No account with the e-mail ${email}.`);
      return 1;
    }
    const grant = adminGrant(user.id, check.credits, reason, new Date());
    if (!grant.ok) return 1;
    const repo = createPostgresRepository(db);
    const before = await repo.balance(user.id);
    console.log(`Account ${email} (${user.id}), balance ${before} Credits`);
    console.log(`Grant ${grant.credits} Credits, ref ${grant.ref}`);
    if (!argv.includes("--yes")) {
      console.log("Nothing booked. Add --yes to book.");
      return 0;
    }
    // By the ref, not the balance: a grant that pays off an open debt books without changing the balance.
    const booked = async () => (await repo.grants(user.id)).some((g) => g.ref === grant.ref);
    if (await booked()) {
      console.log(`This ref was already booked, nothing changed. Balance ${before}.`);
      return 0;
    }
    await repo.grant(user.id, grant.credits, grant.ref);
    console.log(`Booked. New balance ${await repo.balance(user.id)} Credits.`);
    return 0;
  } finally {
    await db.pool.end();
  }
}
