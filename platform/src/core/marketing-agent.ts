import type { AgentSpec, ToolSpec } from "./director";
import { scrubRoute, type ToolCall } from "./director-stream";
import {
  findStyle, flowRules, LINE_MAX, MS_CATEGORIES, MS_STYLES, MS_TEMPLATES, styleAvailable, styleCover, WISH_MAX,
  type MsCategoryId, type MsKind, type MsStyle,
} from "./marketing";

/**
 * Marketing Agent: from a brief (product, goal, channels, audience) to a campaign plan of up to four creatives, each a
 * style or template of the Marketing Agent with its lettering or spoken line, format, length, a post caption and a
 * price. Like the Director it only proposes: every creative starts with the user's click at the price shown. It runs
 * through the Director's turn (streaming, daily budget, paid models, sanitizer) with its own prompt and tool.
 */

/** What the agent knows about the inputs at hand. The product photo is the turn's photo (vision models see it). */
export type MarketingAgentContext = {
  hasProduct: boolean;
  hasAvatar: boolean;
  product?: { name?: string; description?: string };
};

/** The settings a price depends on (the files only by their presence), as POST /api/marketing/quote takes them. */
export type MarketingShape = { product: boolean; avatar: boolean; wish?: string; aspect?: string; duration?: number };

export type MarketingProposal = {
  type: "marketing";
  styleId: string;
  title: string;
  category: MsCategoryId;
  kind: MsKind;
  cover: string | null;
  /** Lettering (text styles), the spoken line (UGC) or a scene wish. */
  wish?: string;
  aspect: string;
  duration?: number;
  /** Post text for the channel, written by the agent. */
  caption?: string;
  why: string;
  /** Inputs the user still has to add before it can start. */
  needs: ("product" | "avatar")[];
  lettering: boolean;
  spoken: boolean;
  credits: number | null;
};

const MAX_CREATIVES = 4;
const CAPTION_MAX = 600;
const WHY_MAX = 240;

export const MARKETING_TOOLS: ToolSpec[] = [
  {
    name: "propose_creative",
    description: "Propose one creative of the campaign: a style or template of the Marketing Agent with its text and settings.",
    parameters: {
      type: "object",
      properties: {
        style_id: { type: "string", description: "A style id or template id from the list" },
        wish: {
          type: "string",
          description:
            "Lettering styles: the exact text in the image, at most 6 words, in the audience's language. UGC: the sentence the person says, " +
            "at most 160 characters, in the audience's language. Other styles: optional short scene wish in English.",
        },
        aspect_ratio: { type: "string", description: "One of the style's formats, e.g. 9:16 for Stories, Reels and TikTok, 1:1 or 3:4 for the feed" },
        duration: { type: "number", description: "Video length in seconds, only for video styles, within the style's range" },
        caption: { type: "string", description: "Ready-to-post caption for the channel in the audience's language, with 2 to 4 hashtags" },
        why: { type: "string", description: "One short sentence in the user's language (English by default): what this creative does for the goal" },
      },
      required: ["style_id", "why"],
    },
  },
];

const NEED: Record<string, string> = { required: "required", optional: "optional", none: "no" };

function line(s: MsStyle) {
  const r = flowRules(s.flow);
  const text = s.flow === "ugc" ? "spoken sentence (required)" : s.prompt.includes("{headline}") ? "lettering in the image" : "scene wish";
  const formats = r.aspects.length ? r.aspects.join(", ") : `fixed ${s.aspect}`;
  const length = r.duration ? `, length ${r.duration.steps ? r.duration.steps.join("/") : `${r.duration.min}–${r.duration.max}`} s` : "";
  return `- ${s.id} | ${s.title} | ${r.kind === "video" ? "video" : "image"} | formats ${formats}${length} | product ${NEED[r.product]}, avatar ${NEED[r.avatar]} | wish = ${text}`;
}

function catalogText(has: (jobType: string) => boolean): string {
  return MS_CATEGORIES.map((c) => {
    const styles = MS_STYLES.filter((s) => s.category === c.id && styleAvailable(s, has));
    if (!styles.length) return "";
    const rows = styles.map((s) => {
      const templates = MS_TEMPLATES.filter((t) => t.style === s.id).map((t) => `${t.id} (${t.title})`).join(", ");
      return `${line(s)}${templates ? `\n  Templates: ${templates}` : ""}`;
    });
    return `## ${c.label}\n${rows.join("\n")}`;
  }).filter(Boolean).join("\n\n");
}

function systemPrompt(ctx: MarketingAgentContext, has: (jobType: string) => boolean, seesPhoto: boolean): string {
  const name = ctx.product?.name?.trim().slice(0, 120);
  const about = ctx.product?.description?.trim().slice(0, 400);
  return `You are the Tevyon Marketing Agent, a performance marketer and art director. From a brief you plan a small campaign of finished creatives.
Language: always reply in the language of the user's last message; if it is unclear, reply in English. The same goes for why. Short and concrete: at most 3 sentences on the idea of the campaign, without filler.
Propose 2 to 4 creatives via the tool propose_creative that together make a campaign: different categories and formats that fit the goal and the channels (Stories, Reels and TikTok 9:16, feed 1:1 or 3:4, shop and marketplace 1:1, YouTube 16:9).
Take style_id only from the list. Templates are concrete scenes of a style; take them when the scene fits the product.
For styles with "lettering in the image" write a short, strong text. For UGC a natural spoken sentence. Write a caption for the channel for every creative.
Styles with "avatar required" only when an avatar photo is there. No celebrities, no third-party brands, no promises of cures, nothing misleading.
Name only Tevyon terms, never providers, models or internal IDs in the text. The interface shows the prices, name no numbers.
At most one question back, and only when nothing sensible works without it.

Product photo: ${ctx.hasProduct ? "yes" : "no (creatives that require a product are still possible, the user adds the photo later)"}
Avatar photo: ${ctx.hasAvatar ? "yes" : "no"}${name ? `\nProduct: ${name}` : ""}${about ? `\nDescription: ${about}` : ""}${seesPhoto ? "\nYou can see the product photo. Say in half a sentence what you see, and shape the creatives around it." : ""}

Styles and templates:
${catalogText(has)}`;
}

const text = (v: unknown, max: number) => {
  const s = typeof v === "string" ? scrubRoute(v).trim().replace(/\s+/g, " ") : "";
  return s ? s.slice(0, max) : undefined;
};

function toCreative(call: ToolCall, ctx: MarketingAgentContext, has: (jobType: string) => boolean, quote: (styleId: string, shape: MarketingShape) => number | null): MarketingProposal | null {
  if (call.name !== "propose_creative") return null;
  const style = findStyle(text(call.args.style_id, 80) ?? "");
  if (!style || !styleAvailable(style, has)) return null;
  const rules = flowRules(style.flow);
  if (rules.avatar === "required" && !ctx.hasAvatar) return null;
  const spoken = style.flow === "ugc";
  const wish = text(call.args.wish, spoken ? LINE_MAX : WISH_MAX);
  if (spoken && !wish) return null;
  if ((style.flow === "poster" || style.flow === "motion") && !ctx.hasProduct && !wish) return null;

  const asked = text(call.args.aspect_ratio, 10);
  const aspect = asked && rules.aspects.includes(asked) ? asked : style.aspect;
  let duration: number | undefined;
  if (rules.duration) {
    const d = rules.duration;
    const n = call.args.duration;
    const ok = typeof n === "number" && Number.isInteger(n) && n >= d.min && n <= d.max && (!d.steps || d.steps.includes(n));
    duration = ok ? n : d.default;
  }
  const needs: MarketingProposal["needs"] = rules.product === "required" && !ctx.hasProduct ? ["product"] : [];
  const avatar = ctx.hasAvatar && rules.avatar !== "none";
  const caption = text(call.args.caption, CAPTION_MAX);
  return {
    type: "marketing", styleId: style.id, title: style.title, category: style.category, kind: rules.kind,
    cover: style.cover ?? styleCover(style.id) ?? null,
    ...(wish ? { wish } : {}), aspect, ...(duration !== undefined ? { duration } : {}), ...(caption ? { caption } : {}),
    why: text(call.args.why, WHY_MAX) ?? style.title, needs,
    lettering: style.prompt.includes("{headline}"), spoken,
    credits: quote(style.id, { product: ctx.hasProduct || rules.product === "required", avatar, ...(wish ? { wish } : {}), aspect, ...(duration !== undefined ? { duration } : {}) }),
  };
}

/** The Marketing Agent for one turn. `has` tells which job types run today, `quote` prices one run of a style. */
export function marketingAgent(
  ctx: MarketingAgentContext, has: (jobType: string) => boolean, quote: (styleId: string, shape: MarketingShape) => number | null,
): AgentSpec {
  return {
    system: (_hasPhoto, seesPhoto) => systemPrompt(ctx, has, seesPhoto),
    tools: MARKETING_TOOLS,
    max: MAX_CREATIVES,
    fallback: { proposals: "Here is your campaign plan:", empty: "Tell me about your product, the goal and the channels." },
    // The same creative twice (style and text) is shown once.
    propose: (() => {
      const seen = new Set<string>();
      return (call: ToolCall) => {
        const c = toCreative(call, ctx, has, quote);
        if (!c) return null;
        const key = `${c.styleId}|${c.wish ?? ""}|${c.aspect}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return c;
      };
    })(),
  };
}
