import { createMemoryApiKeyRepository, type ApiKeyRepository } from "../api-keys";
import { createMemoryOAuthRepository, type OAuthRepository } from "../oauth";
import { createPostgresApiKeyRepository } from "../postgres-api-keys";
import { createPostgresOAuthRepository } from "../postgres-oauth";
import { pgliteDb } from "./repositories";

/** OAuth runs over the same store as the API keys (its connections are api_keys rows). Both implementations, same tests. */
export const oauthRepositories: [string, () => Promise<{ oauth: OAuthRepository; keys: ApiKeyRepository }>][] = [
  ["memory", async () => ({ oauth: createMemoryOAuthRepository(), keys: createMemoryApiKeyRepository() })],
  [
    "postgres",
    async () => {
      const db = await pgliteDb();
      return { oauth: createPostgresOAuthRepository(db), keys: createPostgresApiKeyRepository(db) };
    },
  ],
];
