import { after } from "next/server";
import { currentAccount, unauthorized } from "@/server/account";
import { COMMUNITY_STATUS, community, handleParam, storageFailure } from "@/server/community";
import { publicBase } from "@/server/media-links";
import { REASON_LABEL, notifyOperator } from "@/server/notify";

/**
 * Reports someone else's profile (name, handle, bio, picture): { reason, note? }. The operator decides; they get a mail
 * for the first report since the last review.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/community/[handle]/report">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { handle } = await ctx.params;
  const name = handleParam(handle);
  const body = ((await req.json().catch(() => null)) ?? {}) as { reason?: unknown; note?: unknown };
  try {
    const res = await (await community()).reportProfile(account.id, name, body);
    if (!res.ok) return Response.json(res, { status: COMMUNITY_STATUS[res.error] ?? 400 });
    if (res.first) {
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : "";
      const page = `${publicBase(req)}/moderation`;
      after(() =>
        notifyOperator("Tevyon: new report on a profile", [
          `The profile @${name.replace(/^@/, "").toLowerCase()} was reported.`,
          `Reason: ${REASON_LABEL[String(body.reason)] ?? String(body.reason)}`,
          ...(note ? [`Note: ${note}`] : []),
          `Review: ${page}`,
        ]),
      );
    }
    return Response.json({ ok: true });
  } catch (e) {
    return storageFailure(e);
  }
}
