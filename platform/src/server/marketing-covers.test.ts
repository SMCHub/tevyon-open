import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findStyle, MS_TEMPLATES } from "../core/marketing";

/** Every template on the wall has its cover in public/marketing (made with ChatGPT). */
describe("marketing agent covers", () => {
  it.each(MS_TEMPLATES.map((t) => [t.id] as const))("%s has its cover", (id) => {
    const cover = findStyle(id)!.cover!;
    expect(existsSync(path.join(process.cwd(), "public", cover))).toBe(true);
  });
});
