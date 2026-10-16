import { randomUUID } from "node:crypto";
import { streamDirectorTurn, type ChatModel, type DirectorEvent, type Proposal } from "@/core/director";
import type { BudgetStatus } from "@/core/director-usage";
import type { JobRepository } from "@/core/repository";
import {
  defaultTextModel, isPaid, messageCredits, publicTextModels, settleCredits, TEXT_MODELS, textModel, turnCostUsd, TYPICAL_TURN,
  type PublicTextModel, type TextModelDef,
} from "@/core/text-models";

/**
 * The Director behind POST /api/director and the MCP tool: checks the request, today's budget and the photo, then
 * runs the turn. What a turn cost stays on the server; the client only learns how much of today's budget is left.
 */
export type DirectorDeps = {
  /** The language model for a text model, or null without a provider key (demo). */
  model(def: TextModelDef): ChatModel | null;
  /** The free daily budget (Ausgewogen and Schnell); its size per account is the budget's business. */
  budget: {
    status(accountId: string, model: TextModelDef): Promise<BudgetStatus>;
    statuses(accountId: string, models: TextModelDef[]): Promise<{ share: number; models: Record<string, { allowed: boolean; turnsLeft: number }> }>;
    record(accountId: string, model: TextModelDef, costUsd: number, credits?: number): Promise<void>;
  };
  /** Whether the account has bought credits, and what it still owes from a refund or dispute. */
  standing(accountId: string): Promise<{ paying: boolean; owed: number }>;
  /** Credits for the strongest models: held at the cap while the turn runs, then settled to what it cost. */
  ledger: Pick<JobRepository, "debit" | "settleDebit" | "voidDebit" | "spentByKey" | "voidStaleHolds">;
  balance(accountId: string): Promise<number>;
  quote(jobType: string, params: Record<string, unknown>): number | null;
  /** One of the caller's uploads as a data URL fit for a vision model, or undefined if it cannot be read. */
  photo(url: string): Promise<string | undefined>;
  /**
   * Counts a free turn of an account without a purchase against the caller's network (src/server/network-limits.ts);
   * false when the network's share for the day is used up. Without it, or without a network, nothing is counted.
   */
  freeTurns?(network: string): Promise<boolean>;
  log?(message: string): void;
};

/**
 * What the client receives: the turn without its cost in USD, then how much of today's free budget is left, or, for
 * the strongest models, the credits the message was charged.
 */
export type ClientEvent =
  | Exclude<DirectorEvent, { type: "usage" }>
  | ({ type: "budget" } & BudgetStatus)
  | { type: "charged"; credits: number }
  | { type: "error"; error: "director_unavailable"; message: string };

export type DirectorError =
  | "invalid_params" | "unknown_model" | "foreign_input" | "director_busy" | "director_budget" | "director_demo" | "director_unavailable"
  | "director_paid_only" | "insufficient_credits" | "credits_owed" | "key_limit_reached" | "director_network_limit";

/** The API key or OAuth connection a turn comes through (MCP, API); dailyLimit null = no limit. Studio sessions have none. */
export type DirectorKey = { id: string; dailyLimit: number | null };

/** A language model in the picker, with what it costs this account today. */
export type ModelChoice = PublicTextModel & { allowed: boolean; turnsLeft?: number; locked?: "purchase" | "credits" | "key_limit" };

export type DirectorInput = {
  history: { role: "user" | "assistant"; content: string }[];
  hasPhoto: boolean;
  /** One of the caller's uploads (/api/media/uploads/<account>/…). */
  photo?: string;
  model: TextModelDef;
};

type Refusal = { ok: false; status: number; error: DirectorError; reply: string; limit?: number; used?: number };
/**
 * stop(): the user left (a paid message costs its typical price, so stopping early is never free); stop("failed"): the
 * server gave up on its own (a deadline, an error of ours), and a paid message goes back in full.
 */
export type DirectorStart = { ok: true; model: TextModelDef; events: AsyncGenerator<ClientEvent>; stop(reason?: "left" | "failed"): void } | Refusal;

const MAX_MESSAGES = 20;
const MAX_CHARS = 2_000;
/** The whole history the model sees, newest first kept: bounds what a paid message can cost (MAX_TURN). */
const MAX_HISTORY_CHARS = 12_000;
/** Turns one account may run at the same time (one per open tab is plenty). */
const MAX_PARALLEL = 2;
const DAY_MS = 86_400_000;

/** A Director message streams for minutes at most; a hold older than this belongs to a message that never ended. */
export const STALE_HOLD_MS = 30 * 60_000;

/** A key's daily limit as the ledger checks it (rolling 24 hours, like jobs). */
const keyLimitOf = (key?: DirectorKey) =>
  key && typeof key.dailyLimit === "number" ? { credits: key.dailyLimit, since: Date.now() - DAY_MS } : undefined;

const REPLY: Record<Exclude<DirectorError, "director_budget" | "director_paid_only" | "insufficient_credits" | "credits_owed" | "key_limit_reached">, string> = {
  invalid_params: "I didn't understand that. Tell me what you want to make.",
  unknown_model: "I don't know this model. Pick one from the list.",
  foreign_input: "This photo does not belong to your account.",
  director_busy: "I'm still working on your last message. One moment.",
  director_demo: "The Director is not available in demo mode: COMFY_API_KEY is missing.",
  director_unavailable: "I can't get through right now. Please try again in a moment.",
  director_network_limit: "Your network has used up today's free Director allowance. This limit no longer applies once you buy Credits; otherwise it resets tomorrow.",
};

const refuse = (status: number, error: keyof typeof REPLY): Refusal => ({ ok: false, status, error, reply: REPLY[error] });

/** An account that owes credits (refund, dispute) gets no Director turns until new credits have paid the amount. */
const owes = (owed: number): Refusal => ({
  ok: false, status: 402, error: "credits_owed",
  reply: `Your account owes ${owed} Credits from a refund or a payment dispute. The Director is paused until they are settled. New Credits pay off this amount first.`,
});

/** An upload of ours: the account in the path must be the caller's. */
const UPLOAD = /^\/api\/media\/uploads\/([0-9a-f-]{36})\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Checks a request body: the conversation ends with the user, the model is one of ours, the photo is the caller's. */
export function parseDirectorInput(accountId: string, body: unknown): { ok: true; input: DirectorInput } | Refusal {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const history = (Array.isArray(b.history) ? (b.history as unknown[]) : [])
    .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : {}))
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => ({ role: m.role as "user" | "assistant", content: (m.content as string).slice(0, MAX_CHARS) }))
    .slice(-MAX_MESSAGES);
  // The newest messages, without gaps, until the history budget is spent.
  let chars = 0;
  let from = history.length;
  while (from > 0 && (chars += history[from - 1]!.content.length) <= MAX_HISTORY_CHARS) from--;
  history.splice(0, from);
  if (history.at(-1)?.role !== "user") return refuse(400, "invalid_params");
  const model = b.model === undefined || b.model === null ? defaultTextModel() : typeof b.model === "string" ? textModel(b.model) : undefined;
  if (!model) return refuse(400, "unknown_model");
  let photo: string | undefined;
  if (b.photo !== undefined && b.photo !== null) {
    const m = typeof b.photo === "string" ? UPLOAD.exec(b.photo) : null;
    if (!m || m[1] !== accountId) return refuse(400, "foreign_input");
    photo = b.photo as string;
  }
  const hasPhoto = b.hasPhoto === true || Boolean(photo);
  if (b.agent !== undefined && b.agent !== null && b.agent !== "director") return refuse(400, "invalid_params");
  return { ok: true, input: { history, hasPhoto, ...(photo ? { photo } : {}), model } };
}

export function createDirectorService(deps: DirectorDeps) {
  const running = new Map<string, number>();
  const log = (m: string) => deps.log?.(m);

  /**
   * Starts a turn and waits for its first event, so a provider that refuses (no credit, outage) is answered with a
   * proper status instead of a broken stream. Every turn that reached the model counts against the budget: with its
   * real cost, or a typical turn if the cost never arrived (user left, stream broke).
   * network: the caller's network as a key, for the free turns of accounts without a purchase (deps.freeTurns).
   */
  async function start(accountId: string, input: DirectorInput, signal?: AbortSignal, key?: DirectorKey, network?: string): Promise<DirectorStart> {
    const busy = running.get(accountId) ?? 0;
    if (busy >= MAX_PARALLEL) return refuse(429, "director_busy");
    running.set(accountId, busy + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const left = (running.get(accountId) ?? 1) - 1;
      if (left > 0) running.set(accountId, left);
      else running.delete(accountId);
    };

    let hold: { ref: string } | undefined;
    let settled = false;
    try {
      const model = deps.model(input.model);
      if (!model) {
        release();
        return refuse(503, "director_demo");
      }
      const name = input.model.name;
      // The strongest models cost credits per message: held at the cap now, settled to what the turn cost at the end.
      if (isPaid(input.model)) {
        const standing = await deps.standing(accountId);
        if (standing.owed > 0) {
          release();
          return owes(standing.owed);
        }
        if (!standing.paying) {
          release();
          const reply = `${name} and the other strongest models unlock with your first Credits purchase. Until then, Claude Sonnet 5.5 plans with you for free.`;
          return { ok: false, status: 402, error: "director_paid_only", reply };
        }
        const price = messageCredits(input.model);
        // A message whose process ended mid-stream never settled its hold: give it back before taking a new one.
        await deps.ledger.voidStaleHolds(Date.now() - STALE_HOLD_MS, accountId);
        const ref = `director:${randomUUID()}`;
        const keyLimit = keyLimitOf(key);
        const held = await deps.ledger.debit({
          accountId, credits: price.cap, ref, kind: "director", model: name, hold: true, ...(key ? { apiKeyId: key.id } : {}), ...(keyLimit ? { keyLimit } : {}),
        });
        if (!held.ok && held.error === "key_limit_reached") {
          release();
          const reply = `This access has reached its daily limit of ${held.limit} Credits (${held.used} used). A message with ${name} holds up to ${price.cap} Credits.`;
          return { ok: false, status: 429, error: "key_limit_reached", reply, limit: held.limit, used: held.used };
        }
        if (!held.ok) {
          release();
          const reply = `A message with ${name} costs up to ${price.cap} Credits, usually ${price.typical}. Your balance is not enough for that right now.`;
          return { ok: false, status: 402, error: "insufficient_credits", reply };
        }
        hold = { ref };
      } else if (!(await deps.budget.status(accountId, input.model)).allowed) {
        release();
        const { owed } = await deps.standing(accountId);
        if (owed > 0) return owes(owed);
        const reply = `Your Director allowance for today is not enough for ${name}. Pick a faster model or come back tomorrow.`;
        return { ok: false, status: 429, error: "director_budget", reply };
      } else if (network && deps.freeTurns && !(await deps.standing(accountId)).paying && !(await deps.freeTurns(network))) {
        release();
        return refuse(429, "director_network_limit");
      }

      const photo = input.photo && input.model.vision
        ? await deps.photo(input.photo).catch((e) => void log(`[director] photo not loaded: ${message(e)}`))
        : undefined;
      const ac = new AbortController();
      let events: AsyncGenerator<ClientEvent> | undefined;
      let stopped: "left" | "failed" = "left";
      const stop = (reason: "left" | "failed" = "left") => {
        stopped = reason;
        ac.abort();
        void events?.return(undefined).catch(() => {});
      };
      const onAbort = () => stop("left");
      signal?.addEventListener("abort", onAbort, { once: true });
      const turn = streamDirectorTurn({
        history: input.history, hasPhoto: input.hasPhoto, ...(photo ? { photo: { dataUrl: photo } } : {}),
        model, quote: deps.quote, signal: ac.signal,
      });

      let costUsd: number | null = null;
      let charged = 0;
      /**
       * Ends the turn once. refused: the provider said no before the first word (nothing is due); failed: it broke
       * mid-answer (a paid message goes back, the free budget counts it); left or done: the turn counts with its real
       * cost, or a typical turn if the cost never came.
       */
      const settle = async (outcome: "refused" | "failed" | "left" | "done") => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        ac.abort();
        await turn.return(undefined).catch(() => {});
        release();
        const book = async () => {
          const cost = costUsd ?? turnCostUsd(input.model, TYPICAL_TURN);
          if (hold) {
            if (outcome === "refused" || outcome === "failed") return deps.ledger.voidDebit(hold.ref);
            charged = settleCredits(input.model, cost);
            await deps.ledger.settleDebit(hold.ref, charged);
            return deps.budget.record(accountId, input.model, cost, charged);
          }
          if (outcome !== "refused") await deps.budget.record(accountId, input.model, cost);
        };
        await book().catch((e) => log(`[director] turn not booked: ${message(e)}`));
      };

      let first: IteratorResult<DirectorEvent>;
      try {
        first = await turn.next();
      } catch (e) {
        const left = ac.signal.aborted;
        if (!left) log(`[director] ${input.model.id}: ${message(e)}`);
        await settle(left ? stopped : "refused");
        return refuse(503, "director_unavailable");
      }

      async function* relay(): AsyncGenerator<ClientEvent> {
        try {
          let outcome: "failed" | "done" = "done";
          try {
            for (let r = first; !r.done; r = await turn.next()) {
              if (r.value.type === "usage") costUsd = r.value.costUsd;
              else yield r.value;
            }
          } catch (e) {
            if (ac.signal.aborted) return;
            log(`[director] ${input.model.id}: ${message(e)}`);
            outcome = "failed";
            yield { type: "error", error: "director_unavailable", message: REPLY.director_unavailable };
          }
          await settle(outcome);
          if (hold) {
            if (charged > 0) yield { type: "charged", credits: charged };
          } else {
            yield { type: "budget", ...(await deps.budget.status(accountId, input.model)) };
          }
        } finally {
          await settle(stopped);
        }
      }
      events = relay();
      return { ok: true, model: input.model, events, stop };
    } catch (e) {
      // A check that throws (database, ledger) must keep neither the account's turn slot nor its held credits.
      if (hold && !settled) await deps.ledger.voidDebit(hold.ref).catch(() => {});
      release();
      throw e;
    }
  }

  /** POST /api/director: the turn as server-sent events (`data: <ClientEvent>`), or JSON with an error code. */
  async function respond(accountId: string, body: unknown, signal?: AbortSignal, key?: DirectorKey, network?: string): Promise<Response> {
    const parsed = parseDirectorInput(accountId, body);
    if (!parsed.ok) return refusal(parsed);
    const started = await start(accountId, parsed.input, signal, key, network);
    return started.ok ? eventStream(started) : refusal(started);
  }

  /** GET /api/director/models: every model with what it costs this account today (no vendor ids, no USD). */
  async function overview(accountId: string, key?: DirectorKey): Promise<{ share: number; paying: boolean; owed: number; models: ModelChoice[] }> {
    const limit = keyLimitOf(key);
    const [standing, balance, today, used] = await Promise.all([
      deps.standing(accountId), deps.balance(accountId), deps.budget.statuses(accountId, TEXT_MODELS),
      key && limit ? deps.ledger.spentByKey(key.id, limit.since) : Promise.resolve(0),
    ]);
    const models = publicTextModels().map((m): ModelChoice => {
      if (!m.paid) return { ...m, ...today.models[m.id]! };
      const cap = m.credits!.cap;
      const locked = !standing.paying || standing.owed > 0 ? "purchase"
        : balance < cap ? "credits"
        : limit && used + cap > limit.credits ? "key_limit" : undefined;
      return { ...m, allowed: !locked, ...(locked ? { locked } : {}) };
    });
    return { share: today.share, paying: standing.paying, owed: standing.owed, models };
  }

  return { start, respond, overview };
}

function refusal(r: Refusal): Response {
  const extra = r.limit !== undefined ? { limit: r.limit, used: r.used } : {};
  return Response.json({ ok: false, error: r.error, reply: r.reply, ...extra }, { status: r.status });
}

function eventStream(s: Extract<DirectorStart, { ok: true }>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      const r = await s.events.next();
      try {
        if (r.done) c.close();
        else c.enqueue(enc.encode(`data: ${JSON.stringify(r.value)}\n\n`));
      } catch {
        // the client left while the next event was on its way
      }
    },
    async cancel() {
      s.stop();
      await s.events.return(undefined);
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}

/**
 * A turn collected for callers that do not stream (MCP): the reply, the proposals, the replies the user can send next,
 * and either what is left of today's free budget or the credits a message with one of the strongest models was charged.
 */
export async function collectTurn(events: AsyncIterable<ClientEvent>) {
  const turn: { reply: string; proposals: Proposal[]; suggestions: string[]; error?: string; budget?: BudgetStatus; charged?: number } = {
    reply: "", proposals: [], suggestions: [],
  };
  for await (const e of events) {
    if (e.type === "done") turn.reply = e.reply;
    else if (e.type === "proposals") turn.proposals = e.proposals;
    else if (e.type === "suggestions") turn.suggestions = e.suggestions;
    else if (e.type === "error") turn.error = e.error;
    else if (e.type === "budget") turn.budget = { allowed: e.allowed, turnsLeft: e.turnsLeft, share: e.share };
    else if (e.type === "charged") turn.charged = e.credits;
  }
  return turn;
}
