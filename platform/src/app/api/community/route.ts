import { currentAccount } from "@/server/account";
import { community, feedOptions, storageFailure } from "@/server/community";

/**
 * The community: public creations of all accounts, newest first (?sort=popular: most liked first). ?kind=image|video,
 * ?following=1 (only creators the signed-in account follows), ?before=<next> for the next page, ?limit (up to 60).
 * Open to everyone; a signed-in account also learns what it likes.
 */
export async function GET(req: Request) {
  const viewer = await currentAccount();
  try {
    return Response.json({ ok: true, ...(await (await community()).feed(feedOptions(req), viewer?.id)) });
  } catch (e) {
    return storageFailure(e);
  }
}
