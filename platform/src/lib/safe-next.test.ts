import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeNext("/oauth/authorize?client_id=tcc_x&state=a%20b")).toBe("/oauth/authorize?client_id=tcc_x&state=a%20b");
    expect(safeNext("/device?code=WDJB-MJHT")).toBe("/device?code=WDJB-MJHT");
  });

  it("never sends anyone to another site or a script", () => {
    for (const bad of ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "evil.example", "", null, undefined, "/x\u0000y", "/" + "a".repeat(2001)]) {
      expect(safeNext(bad)).toBeNull();
    }
  });

  it("does not loop back to the login", () => {
    expect(safeNext("/login?next=/x")).toBeNull();
  });
});
