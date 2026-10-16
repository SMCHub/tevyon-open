/**
 * Local mode: on a developer's machine without a Supabase project, every request is one local account, so the
 * platform runs with nothing but `COMFY_API_KEY` (README “Run it locally”). Never in production, never on Vercel and
 * never next to a configured Supabase project: there the login decides.
 */
export const LOCAL_ACCOUNT = { id: "00000000-0000-4000-8000-00000000c0de", email: "you@localhost.test", via: "session" as const };

type Env = Record<string, string | undefined>;

export function localAccount(env: Env = process.env): typeof LOCAL_ACCOUNT | null {
  if (env.NODE_ENV === "production" || env.VERCEL || env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return LOCAL_ACCOUNT;
}
