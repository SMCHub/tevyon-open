import { oauthHttp } from "@/server/oauth-routes";

/** RFC 7591 dynamic client registration (claude.ai, Claude Code, Cursor register themselves here). */
const serve = (req: Request) => oauthHttp().register(req);
export const POST = serve;
export const OPTIONS = serve;
