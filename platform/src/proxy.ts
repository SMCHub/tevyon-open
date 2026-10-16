import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "./lib/safe-next";
import { localAccount } from "./server/local-account";

/**
 * Reachable without a Studio session: the login, the public price page, the community and creators' pages
 * (/profile/<handle>; the own /profile stays behind the login), the API (checks its own auth) and the OAuth endpoints
 * for clients.
 */
const PUBLIC = [
  "/login", "/community", "/profile/", "/api/", "/.well-known/", "/oauth/register", "/oauth/token", "/oauth/revoke", "/oauth/device_authorization",
];

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out visitors of app pages to
 * /login?next=…, so the OAuth consent and the CLI login page come back after signing in. This is an optimistic
 * check; API routes verify the JWT themselves.
 */
export async function proxy(request: NextRequest) {
  // Local mode (no Supabase on a dev machine): one local account, nothing to refresh.
  if (localAccount()) return request.nextUrl.pathname.startsWith("/login") ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next({ request });
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all) => {
        for (const { name, value } of all) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of all) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (!signedIn && !PUBLIC.some((p) => pathname.startsWith(p))) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  if (signedIn && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next")) ?? "/", request.url));
  }
  // The OAuth consent and the CLI login confirmation must never run inside a frame (clickjacking).
  if (pathname.startsWith("/oauth/") || pathname.startsWith("/device")) {
    response.headers.set("x-frame-options", "DENY");
    response.headers.set("content-security-policy", "frame-ancestors 'none'");
  }
  return response;
}

// api/uploads stays out: the proxy cuts request bodies at 10 MB, reference videos may be 50 MB (the routes check auth).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|login-art/|cine/|api/uploads|.*\\.(?:svg|png|jpg|webp|mp4)$).*)"],
};
