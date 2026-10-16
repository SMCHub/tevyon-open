import { currentAccount, unauthorized } from "@/server/account";
import { marketingQuote, type MsShape } from "@/server/marketing";
import { runtime } from "@/server/runtime";

/** POST /api/marketing/quote with { styleId, product?, avatar?, adReference?, aspect?, duration? } (booleans for files): credits of one run. */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const shape: MsShape = {
    product: b.product === true, avatar: b.avatar === true, adReference: b.adReference === true,
    ...(typeof b.wish === "string" ? { wish: b.wish } : {}),
    ...(typeof b.aspect === "string" ? { aspect: b.aspect } : {}),
    ...(typeof b.duration === "number" ? { duration: b.duration } : {}),
  };
  const q = marketingQuote(await runtime(), typeof b.styleId === "string" ? b.styleId : "", shape);
  return Response.json(q, { status: q.ok ? 200 : 400 });
}
