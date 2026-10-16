import { currentAccount } from "@/server/account";
import { checkDeviceToken, sameOrigin } from "@/server/consent";
import { oauth } from "@/server/keys";

/** Confirms or declines a CLI login for the signed-in account, then shows the result page. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const account = await currentAccount();
  if (!account || account.via !== "session") return new Response("Bitte zuerst bei Tevyon anmelden.", { status: 401 });
  const form = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const code = form.code ?? "";
  if (!checkDeviceToken(form.csrf, account.id, code)) return new Response("Forbidden", { status: 403 });
  const allow = form.decision === "allow";
  const ok = await oauth().deviceDecide(code, { id: account.id, ...(account.email ? { email: account.email } : {}) }, allow);
  const target = ok ? `/device?done=${allow ? "allowed" : "denied"}` : `/device?code=${encodeURIComponent(code)}`;
  return new Response(null, { status: 303, headers: { location: target, "cache-control": "no-store" } });
}
