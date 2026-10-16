import type { ApiKeyView } from "../core/api-keys";
import type { RecipeTag } from "../core/jobs";
import type { JobFailure, JobRecord, JobStatus } from "../core/repository";

/**
 * What the “API & MCP” console shows: every key and connection with what it spent in the last 24 hours, and the
 * latest jobs that agents and the CLI started. Only Tachyon terms: no written prompt, no vendor handle or detail.
 */
export type AccessKey = ApiKeyView & { spent24h: number };

export type AgentActivity = {
  id: string;
  jobType: string;
  model: string;
  status: JobStatus;
  credits: number;
  origin: "mcp" | "cli" | "api";
  keyId: string | null;
  /** The key or app that started it; null when it has been revoked since. */
  keyName: string | null;
  createdAt: number;
  /** First output, for a thumbnail (an image, or a video's first frame); null while the job has none. The console shows it only for finished jobs. */
  preview: string | null;
  media: "image" | "video" | null;
  /** The user's own prompt, never the one the prompt skill wrote. For a preset only the user's wish. */
  prompt: string;
  /** Title of the preset that ran; its recipe prompt stays on the server. */
  preset?: string;
  error?: JobFailure;
};

export type AccessOverview = { keys: AccessKey[]; activity: AgentActivity[] };

const MAX_ACTIVITY = 12;

export function buildAccessOverview(input: { keys: ApiKeyView[]; spent: Record<string, number>; jobs: JobRecord[] }): AccessOverview {
  const names = new Map(input.keys.map((k) => [k.id, k.name]));
  const activity: AgentActivity[] = [];
  for (const j of input.jobs) {
    if (!j.origin || j.origin === "web") continue;
    const first = j.outputs[0];
    const media = first ? (first.contentType.startsWith("video/") ? "video" : "image") : null;
    const recipe = "recipe" in j.params ? (j.params.recipe as RecipeTag) : undefined;
    activity.push({
      id: j.id,
      jobType: j.jobType,
      model: j.model,
      status: j.status,
      credits: j.credits,
      origin: j.origin,
      keyId: j.apiKeyId ?? null,
      keyName: (j.apiKeyId && names.get(j.apiKeyId)) || null,
      createdAt: j.createdAt,
      preview: first ? first.url : null,
      media,
      prompt: recipe ? (recipe.wish ?? "") : typeof j.params.prompt === "string" ? j.params.prompt : "",
      ...(recipe ? { preset: recipe.title } : {}),
      ...(j.error ? { error: j.error } : {}),
    });
    if (activity.length === MAX_ACTIVITY) break;
  }
  return { keys: input.keys.map((k) => ({ ...k, spent24h: input.spent[k.id] ?? 0 })), activity };
}
