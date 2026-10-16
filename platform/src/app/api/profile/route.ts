import { currentAccount, unauthorized } from "@/server/account";
import { COMMUNITY_STATUS, community, isOperator, storageFailure } from "@/server/community";

/**
 * The account's community profile (null until it made one), its public and hidden creations, its numbers (followers,
 * followed accounts, likes received) and whether it moderates the community.
 */
export async function GET() {
  const account = await currentAccount();
  if (!account) return unauthorized();
  try {
    const c = await community();
    const [profile, publications, stats] = await Promise.all([c.profile(account.id), c.mine(account.id), c.stats(account.id)]);
    return Response.json({ ok: true, profile, publications, stats, operator: isOperator(account) });
  } catch (e) {
    return storageFailure(e);
  }
}

/**
 * Creates or changes the profile: { handle, name, bio?, showPrompts?, avatar?, acceptTerms } (acceptTerms only for a
 * new one; avatar: one of the account's own image uploads, null removes it). A public profile is set up by a person in
 * the Studio, never through an agent's key.
 */
export async function PUT(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (account.via !== "session") return Response.json({ ok: false, error: "studio_only" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  try {
    const res = await (await community()).saveProfile(account.id, body as Record<string, unknown>);
    return Response.json(res, { status: res.ok ? 200 : COMMUNITY_STATUS[res.error] ?? 400 });
  } catch (e) {
    return storageFailure(e);
  }
}

/**
 * Deletes the community profile and everything it shares; the creations stay the account's own, privately. Creations
 * moderation took out stay out. Studio only.
 */
export async function DELETE() {
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (account.via !== "session") return Response.json({ ok: false, error: "studio_only" }, { status: 403 });
  try {
    return Response.json(await (await community()).deleteProfile(account.id));
  } catch (e) {
    return storageFailure(e);
  }
}
