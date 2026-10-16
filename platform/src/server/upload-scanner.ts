import { SCAN_CATEGORIES, type ScanCategory, type UploadScanner } from "../core/upload-scan";
import { chatUrl } from "./comfy";

/**
 * The upload scan (core/upload-scan.ts) with a vision model on the Comfy Router's chat route. The file goes inline as base64 (localhost is
 * not reachable from outside, and a blocked file must never be stored first). Images and videos alike: the default
 * model reads both. Server-only; the answer is a category, nothing about who is shown.
 */
export const DEFAULT_SCAN_MODEL = "google/gemini-3.8-flash";

const INSTRUCTIONS = [
  "You check one file a user uploaded to an AI image and video platform, before it is stored. Decide only whether it may be used as an input.",
  "",
  "Block it (allowed: false) if it shows any of these, and name the category:",
  "- minors: any sexual or sexualised depiction of a minor or of a person or character who looks underage, in any style.",
  "- nudity: pornography, sexual acts or explicit nudity (exposed genitals, female nipples in a sexual or explicit context).",
  "- violence: graphic gore, mutilation, real victims of violence, or glorification of real violence.",
  "- extremism: terrorist or violent-extremist propaganda, symbols used as propaganda, hate symbols or hateful slogans.",
  "- documents: identity cards, passports, driving licences, bank cards or other official or financial documents.",
  "- other: other content that is clearly illegal.",
  "",
  "Allow everything else (allowed: true, category: \"none\"): ordinary photos of people (portraits, fashion, swimwear, fitness), products, places, art, film stills, mild action or fantasy violence, brands and logos.",
  "Never identify anyone: do not say or consider who a person is. Judge only what is shown.",
  "If you are unsure whether something is explicit, allow it; block only what clearly falls into a category.",
  'Answer with JSON {"allowed": true|false, "category": "none"|"minors"|"nudity"|"violence"|"extremism"|"documents"|"other"} and nothing else.',
].join("\n");

const categoryOf = (v: unknown): ScanCategory => (SCAN_CATEGORIES as unknown[]).includes(v) ? (v as ScanCategory) : "other";

export function createChatUploadScanner(opts: { apiKey: string; model?: string; fetch?: typeof fetch }): UploadScanner {
  const doFetch = opts.fetch ?? fetch;
  const model = opts.model || DEFAULT_SCAN_MODEL;
  return {
    async scan(file, signal) {
      const url = `data:${file.contentType};base64,${Buffer.from(file.data).toString("base64")}`;
      const media = file.contentType.startsWith("video/") ? { type: "video_url", video_url: { url } } : { type: "image_url", image_url: { url } };
      const res = await doFetch(chatUrl(), {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: INSTRUCTIONS },
            { role: "user", content: [{ type: "text", text: "Check this upload." }, media] },
          ],
          // The default model always thinks (it refuses `enabled: false`): the least effort, and room for it in the budget.
          max_tokens: 1200,
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "scan", strict: true,
              schema: {
                type: "object",
                properties: { allowed: { type: "boolean" }, category: { type: "string", enum: ["none", ...SCAN_CATEGORIES] } },
                required: ["allowed", "category"], additionalProperties: false,
              },
            },
          },
          // Privacy policy: no training on user content, this call included.
          provider: { data_collection: "deny" },
          reasoning: { effort: "low" },
        }),
        ...(signal ? { signal } : {}),
      });
      // A 403 for the input (the model's own moderation flagged it) is a verdict on the file, not an outage. A 403 for
      // our account (key without access, no credits) is not: the upload is refused and can be tried again.
      if (res.status === 403) {
        const body = (await res.clone().json().catch(() => ({}))) as { error_type?: unknown };
        if (body.error_type === undefined || body.error_type === "content_policy_violation") return { allowed: false, category: "other" };
        throw new Error(`upload scan 403 ${String(body.error_type)}`);
      }
      if (!res.ok) throw new Error(`upload scan ${res.status}`);
      const out = (await res.json()) as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
      const choice = out.choices?.[0];
      if (choice?.finish_reason === "content_filter") return { allowed: false, category: "other" };
      const content = (choice?.message?.content ?? "").trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
      let parsed: { allowed?: unknown; category?: unknown };
      try {
        parsed = JSON.parse(content) as typeof parsed;
      } catch {
        throw new Error("upload scan returned no JSON");
      }
      if (parsed.allowed === true) return { allowed: true };
      if (parsed.allowed === false) return { allowed: false, category: categoryOf(parsed.category) };
      throw new Error("upload scan answer has no verdict");
    },
  };
}
