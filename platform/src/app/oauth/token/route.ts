import { oauthHttp } from "@/server/oauth-routes";

/** Token endpoint: authorization code with PKCE, refresh token rotation, and the CLI's device code. */
const serve = (req: Request) => oauthHttp().token(req);
export const POST = serve;
export const OPTIONS = serve;
