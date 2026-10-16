/**
 * The MCP tools as the «API & MCP» console shows them: one line each, and whether a call only reads, spends credits,
 * brings in a file, plans (the Director: free within a daily budget, credits only with the strongest models) or shares a
 * result in the community.
 * src/server/mcp.test.ts keeps this list equal to the tools the server registers.
 */
export type ToolEffect = "read" | "spend" | "upload" | "plan" | "share";

export const TOOL_CARDS: { name: string; text: string; effect: ToolEffect }[] = [
  { name: "list_models", text: "Alle Bild- und Videomodelle mit Parametern, Startpreis und Lebenszyklus.", effect: "read" },
  { name: "get_price", text: "Der Preis in Credits, bevor etwas startet. Kostenlos.", effect: "read" },
  { name: "generate", text: "Startet ein Bild oder Video mit Preisgrenze. Credits zurück bei Fehlschlag.", effect: "spend" },
  { name: "get_job", text: "Status und Ergebnis eines Jobs, wartet auf Wunsch bis er fertig ist.", effect: "read" },
  { name: "list_jobs", text: "Die letzten Jobs des Kontos mit Status und Links zum Ergebnis.", effect: "read" },
  { name: "get_account", text: "Das angemeldete Konto und sein Credit-Stand.", effect: "read" },
  { name: "get_credits", text: "Verfügbar, reserviert, ausgegeben, dazu die letzten Buchungen.", effect: "read" },
  { name: "set_visibility", text: "Teilt ein fertiges Ergebnis in der Community oder macht es wieder privat. Nur auf Wunsch.", effect: "share" },
  { name: "create_upload", text: "Eine signierte Adresse, um ein eigenes Startbild hochzuladen.", effect: "upload" },
  { name: "import_image", text: "Holt ein öffentliches Bild aus dem Web als Startbild.", effect: "upload" },
  { name: "reuse_result", text: "Macht aus einem eigenen fertigen Ergebnis einen Upload für Referenz oder Startbild.", effect: "upload" },
  { name: "request_consent", text: "Jobs mit echten Personen: holt vor dem Start deine Bestätigung im Studio ein.", effect: "plan" },
  { name: "ask_director", text: "Der Director macht aus einem Wunsch zwei bis drei Vorschläge mit Preis. Startet nichts.", effect: "plan" },
  { name: "list_director_models", text: "Die Sprachmodelle des Directors und was eine Nachricht heute kostet.", effect: "read" },
];

export const EFFECT_LABEL: Record<ToolEffect, string> = { read: "liest", spend: "bucht Credits", upload: "lädt hoch", plan: "plant", share: "teilt" };
