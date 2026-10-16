import { currentAccount, unauthorized } from "@/server/account";
import { runtime } from "@/server/runtime";

export async function GET() {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const rt = await runtime();
  return Response.json({ email: account.email ?? null, credits: await rt.repo.balance(account.id), demo: !rt.live });
}
