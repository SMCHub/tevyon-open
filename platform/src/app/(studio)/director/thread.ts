/**
 * The Director's chat as the page keeps it (in localStorage) and as the model gets it back. Pure, so it is tested
 * without a browser (thread.test.ts).
 */

export type Proposal =
  { type: "custom"; jobType: string; kind: "image" | "video"; model: string; prompt: string; params: Record<string, unknown>; why: string; credits: number | null };

export type Msg =
  | { role: "user"; content: string; image?: string }
  | {
      role: "assistant";
      content: string;
      proposals: Proposal[];
      /** Proposal index → the job the user started from it. */
      started: Record<number, string>;
      /** Short replies to tap next (only the last answer shows them). */
      suggestions?: string[];
      /** waiting: no text yet; streaming: text arrives; failed/stopped: kept, but not sent back to the model. */
      state?: "waiting" | "streaming" | "failed" | "stopped";
      /** Credits the message cost (the strongest models are paid per message). */
      charged?: number;
      /** Name of the language model that wrote it. */
      model?: string;
      /** Seconds the answer took ("Worked for …"). */
      took?: number;
    };

export type Assistant = Extract<Msg, { role: "assistant" }>;
type JobStatus = "queued" | "running" | "succeeded" | "failed";

const OUTCOME: Partial<Record<JobStatus, string>> = { succeeded: "done", failed: "failed" };
/** The server keeps 2,000 characters per message: a prompt in the marker is cut, so every status still fits. */
const PROMPT_CHARS = 300;
const short = (s: string) => (s.length > PROMPT_CHARS ? `${s.slice(0, PROMPT_CHARS).trimEnd()}…` : s);

/** One proposal as the model reads it back: what it was, and whether the user started it and how that ended. */
function line(p: Proposal, i: number, job: string | undefined, statusOf: (jobId: string) => JobStatus | undefined): string {
  const what = `${p.model}${typeof p.params.aspect_ratio === "string" ? `, ${p.params.aspect_ratio}` : ""}${typeof p.params.duration === "number" ? `, ${p.params.duration} s` : ""}: ${short(p.prompt)}`;
  const outcome = job ? OUTCOME[statusOf(job) ?? "running"] : undefined;
  return `${i + 1}) ${what}${job ? ` (started${outcome ? `, ${outcome}` : ""})` : ""}`;
}

/**
 * The conversation as the model gets it: its own proposals in short and numbered behind each answer, the started ones
 * marked, so the next turn builds on them (renders stay in the chat for the same reason). Failed,
 * stopped and empty answers stay out.
 */
export function toHistory(msgs: Msg[], statusOf: (jobId: string) => JobStatus | undefined = () => undefined) {
  return msgs
    .filter((m) => m.role === "user" || (m.state !== "failed" && m.state !== "stopped" && m.content.trim()))
    .map((m) => ({
      role: m.role,
      content: m.role === "assistant" && m.proposals.length
        ? `${m.content}\n[Proposals: ${m.proposals.map((p, i) => line(p, i, m.started[i], statusOf)).join(" | ")}]`
        : m.content,
    }));
}

/**
 * A chat saved in the middle of an answer comes back as a stopped answer, never as one still waiting. Proposals of a
 * kind this version no longer has (presets of older chats) are dropped, with their started jobs.
 */
export function restore(msgs: Msg[]): Msg[] {
  return msgs.flatMap((m): Msg[] => {
    if (m.role !== "assistant") return [m];
    const kept = m.proposals.map((p, i) => ({ p, i })).filter(({ p }) => p.type === "custom");
    const started = Object.fromEntries(kept.flatMap(({ i }, k) => (m.started[i] ? [[k, m.started[i]]] : [])));
    const clean = kept.length === m.proposals.length ? m : { ...m, proposals: kept.map(({ p }) => p), started };
    if (m.state !== "waiting" && m.state !== "streaming") return [clean];
    return m.content.trim() ? [{ ...clean, state: "stopped" }] : [];
  });
}
