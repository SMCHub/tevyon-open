import { currentAccount, unauthorized } from "@/server/account";
import { runtime } from "@/server/runtime";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The account's jobs, newest first. The dashboard polls this.
 * ?ids=a,b,c is the status batch for selected jobs (CLI, agents): unknown and foreign ids are left out.
 */
/** Room for a worker pass after the response (on Vercel the pass runs in this request, images take up to 4 min). */
export const maxDuration = 300;

export async function GET(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { jobs, nudge } = await runtime();
  // The Studio polls here every few seconds: on Vercel that is what moves running jobs on (see runtime.nudge).
  nudge();
  const ids = new URL(req.url).searchParams.get("ids");
  if (ids === null) return Response.json({ jobs: await jobs.list(account.id) });
  const wanted = [...new Set(ids.split(",").map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, 50);
  const found = await Promise.all(wanted.map((id) => jobs.get(account.id, id)));
  return Response.json({ jobs: found.filter((j) => j !== undefined) });
}
