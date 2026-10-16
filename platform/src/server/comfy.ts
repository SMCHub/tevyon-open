import { COMFY_ROUTER } from "../core/providers/comfy";

/**
 * One key for everything: media models (providers/comfy.ts) and the language models behind the prompt writer, the
 * Director and the upload scan, which go through the router's OpenAI-compatible chat route.
 */
export const comfyKey = (): string | undefined => process.env.COMFY_API_KEY || undefined;

const base = () => (process.env.COMFY_ROUTER_BASE_URL || COMFY_ROUTER).replace(/\/+$/, "");
/** Chat completions through the Comfy Router (the body is OpenRouter's chat format; `model` names the language model). */
export const chatUrl = () => `${base()}/v2/models/openrouter/chat-completions`;
export const routerBase = base;
