import { currentAccount, unauthorized } from "@/server/account";
import { createLibraryService, LIBRARY_STATUS, marketingLibrary } from "@/server/marketing-library";

const service = () => createLibraryService(marketingLibrary(), { log: (m) => console.warn(m) });

/** PUT /api/marketing/library/{product|reference|favorite}/{id} with the item: stores it, checked (own uploads only). */
export async function PUT(req: Request, ctx: RouteContext<"/api/marketing/library/[kind]/[id]">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { kind, id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const res = await service().put(account.id, kind, id, body);
  return Response.json(res, { status: res.ok ? 200 : LIBRARY_STATUS[res.error] });
}

/** DELETE /api/marketing/library/{kind}/{id}: removes the item (also when it does not exist). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/marketing/library/[kind]/[id]">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { kind, id } = await ctx.params;
  const res = await service().remove(account.id, kind, id);
  return Response.json(res, { status: res.ok ? 200 : LIBRARY_STATUS[res.error] });
}
