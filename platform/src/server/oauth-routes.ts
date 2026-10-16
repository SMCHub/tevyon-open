import { oauth } from "./keys";
import { publicBase } from "./media-links";
import { createOAuthHttp } from "./oauth-http";
import { createOAuthLimits } from "./oauth-limits";
import { rateLimiter } from "./rate-limits";

/**
 * The OAuth endpoints for the Next.js routes: this server's authorization server at the request's origin, with rate
 * limits on registration and device login (src/server/oauth-limits.ts).
 */
export const oauthHttp = () => createOAuthHttp({ oauth: oauth(), base: publicBase, limit: createOAuthLimits(rateLimiter()) });
