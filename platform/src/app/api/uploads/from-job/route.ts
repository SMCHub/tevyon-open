import { reuseOutput } from "@/core/reuse";
import { currentAccount, unauthorized } from "@/server/account";
import { runtime } from "@/server/runtime";

/** POST /api/uploads/from-job {jobId, index?}: one of your finished images or videos as an upload, to use as a reference (or recast clip). */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { jobId?: unknown; index?: unknown };
  if (typeof body.jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.jobId)) return Response.json({ ok: false, error: "invalid_params" }, { status: 400 });
  const index = typeof body.index === "number" && Number.isInteger(body.index) && body.index >= 0 ? body.index : 0;
  const rt = await runtime();
  const res = await reuseOutput(
    {
      getJob: (accountId, jobId) => rt.jobs.get(accountId, jobId),
      read: async (url) => (await rt.media.read(url.replace(/^\/api\/media\//, "")))?.data,
      media: rt.media,
    },
    account.id,
    body.jobId,
    index,
  );
  if (!res.ok) return Response.json(res, { status: res.error === "not_found" ? 404 : 415 });
  return Response.json(res, { status: 201 });
}
