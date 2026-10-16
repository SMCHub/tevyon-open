import { describe, expect, it } from "vitest";
import { LOCAL_ACCOUNT, localAccount } from "./local-account";

describe("local account (run without Supabase)", () => {
  it("signs everyone in as one local account only on a dev machine without Supabase", () => {
    expect(localAccount({ NODE_ENV: "development" })).toEqual(LOCAL_ACCOUNT);
    expect(localAccount({ NODE_ENV: "test" })).toEqual(LOCAL_ACCOUNT);
  });

  it("never in production, and never next to a configured Supabase project", () => {
    expect(localAccount({ NODE_ENV: "production" })).toBeNull();
    expect(localAccount({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(localAccount({ NODE_ENV: "development", VERCEL: "1" })).toBeNull();
  });
});
