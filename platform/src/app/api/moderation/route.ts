import { currentAccount, unauthorized } from "@/server/account";
import { community, isOperator, storageFailure } from "@/server/community";
import { mediaLinks } from "@/server/media-links";

const notFound = () => Response.json({ ok: false, error: "not_found" }, { status: 404 });

/** A signed link (core/media-links.ts): a hidden creation or profile picture opens for nobody else any more. */
function signed(url: string): string | null {
  try {
    return mediaLinks().sign(url);
  } catch {
    return null;
  }
}

/**
 * What waits for the operator: reported or hidden creations and profiles, with reasons and notes, their files as signed
 * links (the operator sees what is hidden). Operators only.
 */
export async function GET() {
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (!isOperator(account)) return notFound();
  try {
    const q = await (await community()).queue();
    return Response.json({
      ok: true,
      creations: q.creations.map((c) => ({ ...c, media: { ...c.media, url: signed(c.media.url) ?? c.media.url } })),
      profiles: q.profiles.map((p) => ({ ...p, avatar: p.avatar && signed(p.avatar) })),
    });
  } catch (e) {
    return storageFailure(e);
  }
}

/**
 * The operator's decision: { target: "creation" | "profile", id: <job id | handle>, action: "hide" | "unhide" | "dismiss",
 * reason? } — hide takes it out (its owner reads the reason), unhide restores it, dismiss leaves it up; the last two
 * settle the reports so far.
 */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  if (!isOperator(account)) return notFound();
  const b = ((await req.json().catch(() => null)) ?? {}) as { target?: unknown; id?: unknown; action?: unknown; reason?: unknown };
  const id = typeof b.id === "string" ? b.id : "";
  const reason = typeof b.reason === "string" ? b.reason : "";
  try {
    const c = await community();
    const run =
      b.target === "creation"
        ? { hide: () => c.hide(id, reason), unhide: () => c.unhide(id), dismiss: () => c.dismiss(id) }
        : b.target === "profile"
          ? { hide: () => c.hideProfile(id, reason), unhide: () => c.unhideProfile(id), dismiss: () => c.dismissProfile(id) }
          : null;
    const action = b.action === "hide" || b.action === "unhide" || b.action === "dismiss" ? b.action : null;
    if (!run || !action || !id) return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
    if (action === "hide" && !reason.trim()) return Response.json({ ok: false, error: "reason_required" }, { status: 400 });
    const res = await run[action]();
    return Response.json(res, { status: res.ok ? 200 : 404 });
  } catch (e) {
    return storageFailure(e);
  }
}
