import { after } from "next/server";
import { currentAccount, unauthorized } from "@/server/account";
import { COMMUNITY_STATUS, UUID, community, storageFailure } from "@/server/community";
import { publicBase } from "@/server/media-links";
import { REASON_LABEL, notifyOperator } from "@/server/notify";

/**
 * Reports someone else's public creation: { reason: rights | person | sexual | violence | minors | other, note? }.
 * Enough reports take it out of the community until the operator looked at it (core/community.ts). The operator gets a
 * mail for the first report since the last review and when reports hid the creation.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/publications/[jobId]/report">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { jobId } = await ctx.params;
  if (!UUID.test(jobId)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const body = ((await req.json().catch(() => null)) ?? {}) as { reason?: unknown; note?: unknown };
  try {
    const res = await (await community()).report(account.id, jobId, body);
    if (!res.ok) return Response.json(res, { status: COMMUNITY_STATUS[res.error] ?? 400 });
    if (res.first || res.hidden) {
      const reason = REASON_LABEL[String(body.reason)] ?? String(body.reason);
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : "";
      const page = `${publicBase(req)}/moderation`;
      after(() =>
        notifyOperator(res.hidden ? "Tevyon: Kreation nach Meldungen ausgeblendet" : "Tevyon: neue Meldung zu einer Kreation", [
          res.hidden ? "Eine Kreation ist nach Meldungen aus der Community genommen, bis du sie geprüft hast." : "Eine Kreation in der Community wurde gemeldet.",
          `Grund: ${reason}`,
          ...(note ? [`Hinweis: ${note}`] : []),
          `Prüfen: ${page}`,
        ]),
      );
    }
    return Response.json({ ok: true });
  } catch (e) {
    return storageFailure(e);
  }
}
