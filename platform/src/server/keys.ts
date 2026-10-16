import { createApiKeys, createMemoryApiKeyRepository, type ApiKeyPrincipal, type ApiKeys } from "@/core/api-keys";
import { createMemoryOAuthRepository, createOAuth, type OAuth } from "@/core/oauth";
import { createPostgresApiKeyRepository } from "@/core/postgres-api-keys";
import { createPostgresOAuthRepository } from "@/core/postgres-oauth";
import { createPgDb } from "./db";

type Access = { keys: ApiKeys; oauth: OAuth };

// Versioned on purpose: after a hot reload that changes the ApiKeys or OAuth API, an instance built from the old code
// must not keep serving. Bump the suffix when their methods change.
const g = globalThis as unknown as { __tachyonAccessV3?: Access };

function access(): Access {
  return (g.__tachyonAccessV3 ??= build());
}

function build(): Access {
  const url = process.env.DATABASE_URL;
  const db = url ? createPgDb(url) : undefined;
  const keys = createApiKeys({ repo: db ? createPostgresApiKeyRepository(db) : createMemoryApiKeyRepository() });
  return { keys, oauth: createOAuth({ repo: db ? createPostgresOAuthRepository(db) : createMemoryOAuthRepository(), keys }) };
}

/** API keys and OAuth connections, on the same database as the jobs (in memory without DATABASE_URL). */
export const apiKeys = (): ApiKeys => access().keys;

/** Tachyon's OAuth authorization server (claude.ai connector, Claude Code, the CLI's device login). */
export const oauth = (): OAuth => access().oauth;

/** A Bearer token: an API key (tch_…) or an OAuth access token (tca_…). Both act for the same account and credits. */
export async function verifyBearer(token: string): Promise<ApiKeyPrincipal | null> {
  if (token.startsWith("tch_")) return apiKeys().verify(token);
  if (token.startsWith("tca_")) return oauth().verifyAccess(token);
  return null;
}
