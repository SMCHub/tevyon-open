import { createMemoryApiKeyRepository, type ApiKeyRepository } from "../api-keys";
import { createPostgresApiKeyRepository } from "../postgres-api-keys";
import { pgliteDb } from "./repositories";

/** Every API key repository runs the same tests. */
export const apiKeyRepositories: [string, () => Promise<ApiKeyRepository>][] = [
  ["memory", async () => createMemoryApiKeyRepository()],
  ["postgres", async () => createPostgresApiKeyRepository(await pgliteDb())],
];
