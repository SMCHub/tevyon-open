import { currentAccount, unauthorized } from "@/server/account";
import { createLibraryService, LIBRARY_STATUS, marketingLibrary } from "@/server/marketing-library";

/** GET /api/marketing/library: the account's saved products, ad references and favourites (503 until migration 0014). */
export async function GET() {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const res = await createLibraryService(marketingLibrary(), { log: (m) => console.warn(m) }).list(account.id);
  return Response.json(res, { status: res.ok ? 200 : LIBRARY_STATUS[res.error] });
}
