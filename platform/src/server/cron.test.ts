import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cronAccess } from "./cron";

const ROOT = path.join(import.meta.dirname, "../..");

describe("cron access", () => {
  it("runs only with the configured secret, and not at all without one", () => {
    expect(cronAccess("Bearer s3cret", undefined)).toBe("not_configured");
    expect(cronAccess(null, "s3cret")).toBe("unauthorized");
    expect(cronAccess("Bearer wrong!", "s3cret")).toBe("unauthorized");
    expect(cronAccess("Bearer s3cret", "s3cret")).toBe("ok");
  });

  it("schedules only cron routes that exist and that the login proxy lets through without a session", async () => {
    // A redirect to /login (307) would stop the cron silently.
    // So the real proxy gets a signed-out request for every cron path and must not answer with a redirect.
    const crons = (JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.map((c) => c.path)).toContain("/api/cron/oauth-cleanup");
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../proxy");
    // Control: the same signed-out request to an app page is redirected, so the check below can see a redirect.
    const page = await proxy(new NextRequest("http://localhost:3100/credits"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
    for (const c of crons) {
      expect(existsSync(path.join(ROOT, "src/app", c.path, "route.ts"))).toBe(true);
      expect(c.schedule).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
      const res = await proxy(new NextRequest(`http://localhost:3100${c.path}`, { headers: { authorization: "Bearer cron" } }));
      expect(res.headers.get("location")).toBeNull();
      expect(res.status).not.toBe(307);
    }
  });
});
