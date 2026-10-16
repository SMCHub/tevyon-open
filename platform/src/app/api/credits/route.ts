import { createCredits, type CreditEntry } from "@/core/credits";
import { CHARGE_LABEL, ORIGIN_LABEL, entryKindLabel, entryTitle } from "@/lib/credit-labels";
import { currentAccount, unauthorized } from "@/server/account";
import { runtime } from "@/server/runtime";

/**
 * The account's statement: summary plus every credit movement, newest first, with the running balance.
 * ?limit=n returns only the latest n entries (the summary always covers everything); ?format=csv downloads it.
 * Works for the Studio session and for API keys (CLI, MCP) alike. Never contains grant refs or provider details.
 */
export async function GET(req: Request) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { repo } = await runtime();
  const [statement, balance] = await Promise.all([createCredits(repo).statement(account.id), repo.balance(account.id)]);
  // Two sources must agree: the booked counter that reservations enforce and the statement read from the bookings.
  if (statement.summary.available !== balance) {
    console.warn(`[credits] drift for ${account.id}: statement ${statement.summary.available}, balance ${balance}`);
  }
  const url = new URL(req.url);

  if (url.searchParams.get("format") === "csv") {
    return new Response(toCsv(statement.entries), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tevyon-credits-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  }

  const limit = Number(url.searchParams.get("limit"));
  const entries = Number.isInteger(limit) && limit > 0 ? statement.entries.slice(0, limit) : statement.entries;
  return Response.json({ summary: statement.summary, entries }, { headers: { "cache-control": "private, no-store" } });
}

const ZURICH = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

/** Semicolon CSV with a BOM, so Excel in Switzerland and Germany opens it with umlauts and columns intact. */
function toCsv(entries: CreditEntry[]): string {
  const cell = (v: string | number) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [["Datum", "Art", "Beschreibung", "Kanal", "Status", "Preis", "Credits", "Saldo"]];
  for (const e of [...entries].reverse()) {
    rows.push([
      ZURICH.format(e.at),
      entryKindLabel(e),
      entryTitle(e),
      e.kind === "job" ? ORIGIN_LABEL[e.origin] : "",
      e.kind === "job" || e.kind === "director" ? CHARGE_LABEL[e.state] : e.kind === "grant" ? "gutgeschrieben" : e.credits < 0 ? "abgezogen" : "zurückgebucht",
      e.kind === "job" || e.kind === "director" ? String(e.amount) : "",
      String(e.credits),
      String(e.balance),
    ]);
  }
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
