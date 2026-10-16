import { createBrowserClient } from "@supabase/ssr";

/** Browser client with the publishable key. Only used for sign-in and sign-out. */
export function supabaseBrowser() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
