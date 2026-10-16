import { oauthHttp } from "@/server/oauth-routes";

/** RFC 7009 token revocation. */
const serve = (req: Request) => oauthHttp().revoke(req);
export const POST = serve;
export const OPTIONS = serve;
