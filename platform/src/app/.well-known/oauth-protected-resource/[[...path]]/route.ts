import { oauthHttp } from "@/server/oauth-routes";

/** RFC 9728: where agents learn that /api/mcp is protected and which authorization server to ask. */
const serve = (req: Request) => oauthHttp().wellKnown(req);
export const GET = serve;
export const OPTIONS = serve;
