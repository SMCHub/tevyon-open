import { catalog } from "./catalog";
import { createStreamSanitizer, matchCount, scrubRoute, type ModelEvent, type ToolCall } from "./director-stream";

/**
 * Tevyon Director: a chat agent that turns a wish into two or three concrete, priced proposals.
 * It only proposes. Starting a job (and spending credits) is always the user's click.
 * The reply streams while the model writes; proposals follow once the model is done.
 */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };
export type { ToolCall } from "./director-stream";
/** The language model behind the Director as a stream of events, injected so tests run without network. */
export type ChatModel = (messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal) => AsyncIterable<ModelEvent>;
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type Proposal =
  { type: "custom"; jobType: string; kind: "image" | "video"; model: string; prompt: string; params: Record<string, unknown>; why: string; credits: number | null };

/**
 * Who answers a turn: the system prompt, the tools the model may call and how a call becomes a checked, priced
 * proposal. The Director is the default; another agent can reuse the same streaming, budget and sanitizing.
 */
export type AgentSpec = {
  system(hasPhoto: boolean, seesPhoto: boolean): string;
  tools: ToolSpec[];
  propose(call: ToolCall): Proposal | null;
  /** Most proposals one turn shows. */
  max: number;
  /** Reply when the model wrote no text: with proposals, and without. */
  fallback: { proposals: string; empty: string };
};

export type DirectorTurn = { reply: string; proposals: Proposal[]; suggestions: string[]; costUsd: number | null };

/**
 * What the Director streams: text while it is written, then the proposals, the replies the user can tap next (only
 * when there are any), the real cost of the turn, the full reply.
 */
export type DirectorEvent =
  | { type: "text"; delta: string }
  | { type: "proposals"; proposals: Proposal[] }
  | { type: "suggestions"; suggestions: string[] }
  | { type: "usage"; costUsd: number | null }
  | { type: "done"; reply: string };

const MAX_PROPOSALS = 3;
const SUGGEST_REPLIES = "suggest_replies";
const MAX_REPLIES = 3;
const MAX_REPLY_CHARS = 60;

/**
 * Replies to tap next (shown under every answer): short, whole, at most three. One that
 * names a purchase route is dropped, not scrubbed, because a scrubbed reply would read wrong.
 */
function toReplies(v: unknown): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(v) ? v : []) {
    if (typeof r !== "string") continue;
    const s = r.replace(/\s+/g, " ").trim();
    if (!s || s.length > MAX_REPLY_CHARS || scrubRoute(s) !== s || out.includes(s)) continue;
    out.push(s);
    if (out.length === MAX_REPLIES) break;
  }
  return out;
}

export const DIRECTOR_TOOLS: ToolSpec[] = [
  {
    name: "propose_custom",
    description: "Propose a custom generation with a model from the catalog and a ready prompt (English, concrete: subject, action, camera, light).",
    parameters: {
      type: "object",
      properties: {
        job_type: { type: "string", description: "Job type from the catalog" },
        prompt: { type: "string", description: "The full prompt in English" },
        aspect_ratio: { type: "string", description: "e.g. 9:16 for TikTok/Reels, 16:9 for YouTube; the one your text names" },
        duration: { type: "number", description: "Video length in seconds, only for video models" },
        why: { type: "string", description: "One short German sentence why this works" },
      },
      required: ["job_type", "prompt", "aspect_ratio", "why"],
    },
  },
  {
    name: SUGGEST_REPLIES,
    description: "2 or 3 short German replies the user can tap next, worded as the user would type them. Call it once, last.",
    parameters: {
      type: "object",
      properties: {
        replies: { type: "array", items: { type: "string" }, description: "Each at most 60 characters" },
      },
      required: ["replies"],
    },
  },
];

function systemPrompt(hasPhoto: boolean, seesPhoto: boolean): string {
  // Job types that need files without a default cannot be proposed from a chat: they stay out.
  const models = catalog.list().filter((d) => !d.sample).map((d) => `- ${d.jobType}: ${d.model} (${d.kind === "video" ? "Video" : "Bild"}) – ${d.tagline}`).join("\n");
  return `Du bist der Tevyon Director, ein KI-Regisseur für virale Kurzvideos und Bilder (TikTok, Reels, Shorts, Werbung). Du schlägst vor, gestartet wird per Klick des Nutzers.
So redest du: Hochdeutsch, Ich-Form, Präsens, ruhig und konkret, ohne Lob («Tolle Idee!»), Floskeln und Ausrufezeichen. Höchstens 3 kurze Sätze.
Dein erster Satz sagt, was du aus dem Wunsch machst: Motiv, Format und Look, z. B. «Ich mache aus deinem Hund einen Clip im Hochformat: Er springt durch ein Portal.» Sekunden und Modelle stehen auf den Karten, nicht im Text. Danach höchstens ein Satz (was du auf dem Foto siehst, was du anders machst, oder eine Rückfrage).
Immer zuerst Text, dann die Tools. Die Karten erscheinen von selbst unter deinem Text: kein «Hier sind meine Ideen». Nenne nie die Zahl deiner Vorschläge, der Text entsteht vor den Karten. why: was das Ergebnis zeigt und warum es wirkt, ein Satz.
Konkreter Wunsch (Thema, Produkt, Idee oder Foto): 2 bis 3 klar verschiedene Vorschläge über propose_custom. Ohne konkreten Wunsch (Gruss, Smalltalk, «hilf mir») keine Vorschläge: begrüsse kurz und frag in einem Satz, was entstehen soll und wofür. Sonst höchstens eine Rückfrage, nur wenn nötig.
Zum Schluss immer suggest_replies: nach Vorschlägen nächste Schritte («Mach es düsterer», «Lieber 16:9 für YouTube»), nach einer Rückfrage ihre wahrscheinlichsten Antworten.
Deine früheren Vorschläge stehen in eckigen Klammern hinter deinen Antworten, «gestartet» hat der Nutzer laufen lassen: Bau darauf auf statt von vorn.
Regulierte Bereiche (Glücksspiel, Alkohol, Tabak, Finanzprodukte, Gesundheit): keine Gewinn-, Rendite- oder Heilsversprechen, nichts für Minderjährige, kurzer Hinweis auf die Werberegeln des Landes (Altersgrenze, Pflichthinweise).
Viralität: Hook in der ersten Sekunde, überraschende Verwandlung, 9:16, kurze Clips (4 bis 6 s). Jeder Vorschlag mit fertigem englischem Prompt.
Echte Personen auf Fotos: freundlich an ihre Einwilligung erinnern. Keine Prominenten, keine Marken, nichts Anstössiges. Nur Modellnamen, nie Anbieter, Router, IDs oder Preise.
Foto angehängt: ${hasPhoto ? "ja" : "nein"}${seesPhoto ? "\nDu siehst das Foto. Sag in einem halben Satz, was du darauf erkennst, und richte die Vorschläge danach aus." : ""}

Modelle (job_type):
${models}`;
}

/** A non-empty string from the model's tool arguments, without purchase routes or vendor ids. */
function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? scrubRoute(v).trim() : "";
  return s || undefined;
}

function toProposal(call: ToolCall, quote: (jobType: string, params: Record<string, unknown>) => number | null): Proposal | null {
  if (call.name === "propose_custom") {
    const def = catalog.get(str(call.args.job_type) ?? "");
    const prompt = str(call.args.prompt);
    if (!def || !prompt) return null;
    const aspect = str(call.args.aspect_ratio);
    const duration = def.kind === "video" && typeof call.args.duration === "number" ? call.args.duration : undefined;
    // What the model asked for; a length the model does not offer keeps the format, anything else the model's defaults.
    const tries = [
      { prompt, ...(aspect ? { aspect_ratio: aspect } : {}), ...(duration !== undefined ? { duration } : {}) },
      ...(aspect && duration !== undefined ? [{ prompt, aspect_ratio: aspect }] : []),
      { prompt },
    ];
    const parsed = tries.map((t) => def.params.safeParse(t)).find((r) => r.success);
    if (!parsed?.success) return null;
    const params = parsed.data as Record<string, unknown>;
    return {
      type: "custom", jobType: def.jobType, kind: def.kind, model: def.model, prompt, params,
      why: str(call.args.why) ?? def.tagline, credits: quote(def.jobType, params),
    };
  }
  return null;
}

/** The Director: viral clips and images as custom jobs. */
export function directorAgent(quote: TurnInput["quote"]): AgentSpec {
  return {
    system: systemPrompt, tools: DIRECTOR_TOOLS, propose: (call) => toProposal(call, quote), max: MAX_PROPOSALS,
    // Fast models sometimes call the tools without a word: then the Director still speaks in its voice.
    fallback: { proposals: "Ich habe deinen Wunsch in Vorschläge übersetzt, gestartet wird mit deinem Klick.", empty: "Was soll entstehen, und wofür?" },
  };
}

type TurnInput = {
  /** Default: the Director with `quote`. */
  agent?: AgentSpec;
  history: { role: "user" | "assistant"; content: string }[];
  hasPhoto: boolean;
  /** The attached photo as data URL, only for models that see images. */
  photo?: { dataUrl: string };
  model: ChatModel;
  quote: (jobType: string, params: Record<string, unknown>) => number | null;
  signal?: AbortSignal;
};

/** One Director turn as a stream: sanitized text while the model writes, then validated, priced proposals and the cost. */
export async function* streamDirectorTurn(input: TurnInput): AsyncGenerator<DirectorEvent> {
  const history: ChatMessage[] = input.history.slice(-20);
  const last = history.at(-1);
  if (input.photo && last?.role === "user" && typeof last.content === "string") {
    history[history.length - 1] = {
      role: "user",
      content: [{ type: "text", text: last.content }, { type: "image_url", image_url: { url: input.photo.dataUrl } }],
    };
  }
  const agent = input.agent ?? directorAgent(input.quote);
  const messages: ChatMessage[] = [{ role: "system", content: agent.system(input.hasPhoto, Boolean(input.photo)) }, ...history];

  const sanitizer = createStreamSanitizer();
  const calls: ToolCall[] = [];
  let suggestions: string[] = [];
  let reply = "";
  let costUsd: number | null = null;
  for await (const e of input.model(messages, agent.tools, input.signal)) {
    if (e.type === "text") {
      const out = sanitizer.push(e.delta);
      if (out) {
        reply += out;
        yield { type: "text", delta: out };
      }
    } else if (e.type === "tool_call") {
      // Replies only for an agent that offers the tool.
      if (e.call.name !== SUGGEST_REPLIES) calls.push(e.call);
      else if (!suggestions.length && agent.tools.some((t) => t.name === SUGGEST_REPLIES)) suggestions = toReplies(e.call.args.replies);
    } else if (e.costUsd !== undefined) {
      costUsd = e.costUsd;
    }
  }
  const rest = sanitizer.flush();
  if (rest) {
    reply += rest;
    yield { type: "text", delta: rest };
  }

  const proposals = calls
    .map((c) => agent.propose(c))
    .filter((p): p is Proposal => p !== null)
    .slice(0, agent.max);
  if (!reply.trim()) {
    reply = proposals.length ? agent.fallback.proposals : agent.fallback.empty;
    yield { type: "text", delta: reply };
  }
  yield { type: "proposals", proposals };
  if (suggestions.length) yield { type: "suggestions", suggestions };
  yield { type: "usage", costUsd };
  // The text came before the tool calls: the final reply names as many ideas as there are cards.
  yield { type: "done", reply: matchCount(reply.trim(), proposals.length) };
}

/** One Director turn, collected: for callers that do not stream (tests, MCP). */
export async function runDirectorTurn(input: TurnInput): Promise<DirectorTurn> {
  const turn: DirectorTurn = { reply: "", proposals: [], suggestions: [], costUsd: null };
  for await (const e of streamDirectorTurn(input)) {
    if (e.type === "proposals") turn.proposals = e.proposals;
    else if (e.type === "suggestions") turn.suggestions = e.suggestions;
    else if (e.type === "usage") turn.costUsd = e.costUsd;
    else if (e.type === "done") turn.reply = e.reply;
  }
  return turn;
}
