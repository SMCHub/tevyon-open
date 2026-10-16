import { oauthHttp } from "@/server/oauth-routes";

/** RFC 8414: Tachyon's authorization server metadata (endpoints, PKCE S256, grant types). */
const serve = (req: Request) => oauthHttp().wellKnown(req);
export const GET = serve;
export const OPTIONS = serve;
