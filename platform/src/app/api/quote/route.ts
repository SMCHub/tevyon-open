import { runtime } from "@/server/runtime";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { jobType?: string; params?: unknown };
  const quote = (await runtime()).jobs.quote(String(body.jobType ?? ""), body.params ?? {});
  return Response.json(quote, { status: quote.ok ? 200 : 400 });
}
