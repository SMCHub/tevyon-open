/**
 * Provider port: the only way the core talks to a model vendor (here the Comfy Router, providers/comfy.ts).
 * Everything returned here is server-only and must never reach a JobView.
 */
export type ProviderOutput = { contentType: string; data: Uint8Array };

export type ProviderFailure = "moderated" | "invalid_request" | "provider_error" | "timeout";

export type ProviderResult =
  | { state: "pending"; handle: string }
  | { state: "completed"; outputs: ProviderOutput[]; costUsd?: number }
  /** costUsd: what the vendor still charged for the failed job, if it says so (server-only, for the real cost). */
  | { state: "failed"; reason: ProviderFailure; detail?: string; costUsd?: number };

export type ProviderRequest = {
  kind: "image" | "video";
  providerModel: string;
  params: Record<string, unknown>;
};

/**
 * Errors are part of the contract, because a request sent twice can be billed twice:
 * - submit throws only when the vendor surely did not take the job (busy, down, unreachable); the worker retries it.
 *   Once a request may have reached the vendor, a lost answer or a timeout comes back as a failed result, never a throw.
 * - poll is a read: it throws on anything transient and the worker asks again later.
 * Both stop when the signal aborts (the worker's own deadline or a shutdown).
 */
export interface Provider {
  /** Image providers may finish synchronously; video providers return a pending handle. */
  submit(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult>;
  poll(handle: string, signal?: AbortSignal): Promise<ProviderResult>;
}
