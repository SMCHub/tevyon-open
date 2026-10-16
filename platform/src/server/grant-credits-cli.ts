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
    console.log("Aufruf: node --env-file=.env.local scripts/grant-credits.ts <email> <credits> <grund> [--yes]");
    return 1;
  }
  const check = adminGrant("-", Number(amount), reason, new Date());
  if (!check.ok) {
    console.log(check.error === "credits_out_of_range" ? "Credits: ganze Zahl von 1 bis 5000." : "Grund fehlt (mindestens ein Wort).");
    return 1;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL fehlt.");
    return 1;
  }
  const db = createPgDb(url);
  try {
    const [user] = await db.query<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [email]);
    if (!user) {
      console.log(`Kein Konto mit der E-Mail ${email}.`);
      return 1;
    }
    const grant = adminGrant(user.id, check.credits, reason, new Date());
    if (!grant.ok) return 1;
    const repo = createPostgresRepository(db);
    const before = await repo.balance(user.id);
    console.log(`Konto ${email} (${user.id}), Saldo ${before} Credits`);
    console.log(`Gutschrift ${grant.credits} Credits, Ref ${grant.ref}`);
    if (!argv.includes("--yes")) {
      console.log("Nichts gebucht. Mit --yes buchen.");
      return 0;
    }
    // By the ref, not the balance: a grant that pays off an open debt books without changing the balance.
    const booked = async () => (await repo.grants(user.id)).some((g) => g.ref === grant.ref);
    if (await booked()) {
      console.log(`Diese Ref war schon gebucht, nichts geändert. Saldo ${before}.`);
      return 0;
    }
    await repo.grant(user.id, grant.credits, grant.ref);
    console.log(`Gebucht. Neuer Saldo ${await repo.balance(user.id)} Credits.`);
    return 0;
  } finally {
    await db.pool.end();
  }
}
