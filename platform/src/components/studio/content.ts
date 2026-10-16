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
  content_moderated: "Stopped by content filter",
  invalid_request: "Settings not accepted",
  generation_failed: "Didn't work",
  timed_out: "Timed out",
};

export const JOB_ERROR: Record<string, string> = {
  content_moderated: "Stopped by the content filter. Credits refunded.",
  invalid_request: "The model does not accept these settings. Credits refunded.",
  generation_failed: "Generation failed. Credits refunded.",
  timed_out: "Timed out. Credits refunded.",
  insufficient_credits: "Not enough Credits for this job.",
  invalid_params: "Please check the prompt and settings.",
  model_retired: "This model is no longer available. Please choose another one.",
  model_paused: "This model is temporarily unavailable. Please try again later or choose another model.",
  price_changed: "The price just changed. Please check the new price and start again.",
  key_limit_reached: "This API key has reached its daily limit. You can change it under \"API & MCP\".",
  image_required: "Please upload a photo first.",
  consent_required: "Please confirm consent.",
  line_required: "Please enter the line to be spoken.",
};
