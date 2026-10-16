/** Presentation-only content for the studio: model covers and the texts for failed jobs. */
/**
 * Covers per model and per family (files under public/). The open version ships none: the menus then show an icon,
 * never a foreign picture. Add `jobType: "/covers/<file>.webp"` here to give a model its cover.
 */
export const FAMILY_COVER: Record<string, string> = {};

/** A model's cover: its own, else its family's, else none (the menu then shows an icon, never a foreign picture). */
export function modelCover(m: { jobType: string; family?: string }): string | undefined {
  return MODEL_COVER[m.jobType] ?? (m.family ? FAMILY_COVER[m.family] : undefined);
}

export const MODEL_COVER: Record<string, string> = {};

/** Short headline of a failed job for tiles; the long sentence stays in JOB_ERROR. */
export const FAILED_TITLE: Record<string, string> = {
  content_moderated: "Vom Inhaltsfilter gestoppt",
  invalid_request: "Einstellungen nicht angenommen",
  generation_failed: "Hat nicht geklappt",
  timed_out: "Zeitüberschreitung",
};

export const JOB_ERROR: Record<string, string> = {
  content_moderated: "Vom Inhaltsfilter gestoppt. Credits zurückerstattet.",
  invalid_request: "Diese Einstellungen nimmt das Modell nicht an. Credits zurückerstattet.",
  generation_failed: "Generierung fehlgeschlagen. Credits zurückerstattet.",
  timed_out: "Zeitüberschreitung. Credits zurückerstattet.",
  insufficient_credits: "Nicht genug Credits für diesen Job.",
  invalid_params: "Bitte Prompt und Einstellungen prüfen.",
  model_retired: "Dieses Modell gibt es nicht mehr. Bitte ein anderes wählen.",
  model_paused: "Dieses Modell ist vorübergehend nicht verfügbar. Bitte später nochmal oder ein anderes Modell.",
  price_changed: "Der Preis hat sich gerade geändert. Bitte den neuen Preis prüfen und nochmal starten.",
  key_limit_reached: "Das Tageslimit dieses API-Schlüssels ist erreicht. Du kannst es unter «API & MCP» ändern.",
  image_required: "Bitte zuerst ein Foto hochladen.",
  consent_required: "Bitte die Einwilligung bestätigen.",
  line_required: "Bitte den Satz eingeben, der gesprochen werden soll.",
};
