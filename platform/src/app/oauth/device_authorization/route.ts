import { oauthHttp } from "@/server/oauth-routes";

/** RFC 8628: `tevyon login` asks for a code here; the user confirms it at /device. */
const serve = (req: Request) => oauthHttp().deviceAuthorization(req);
export const POST = serve;
export const OPTIONS = serve;
