import { describe, expect, it } from "vitest";
import { tilesFor, upscalePlan, upscaleSize } from "./vision";

describe("upscale size", () => {
  it("multiplies by the chosen factor", () => {
    expect(upscaleSize(800, 600, 2)).toEqual({ width: 1600, height: 1200 });
    expect(upscaleSize(800, 600, 4)).toEqual({ width: 3200, height: 2400 });
  });

  it("caps the long side at 4096 px and keeps the shape (a 1086×1448 image ×4 would be 25 MP)", () => {
    expect(upscaleSize(1086, 1448, 4)).toEqual({ width: 3072, height: 4096 });
    expect(upscaleSize(3000, 1000, 2)).toEqual({ width: 4096, height: 1365 });
  });

  it("never returns less than the original", () => {
    expect(upscaleSize(4096, 2048, 2)).toEqual({ width: 4096, height: 2048 });
    expect(upscaleSize(5000, 3000, 4)).toEqual({ width: 5000, height: 3000 });
  });
});

describe("tiles for a fixed-size model input", () => {
  it("covers every pixel exactly once with tiles of at most the core size", () => {
    const W = 300, H = 250, core = 112;
    const tiles = tilesFor(W, H, core);
    const seen = new Uint8Array(W * H);
    for (const t of tiles) {
      expect(t.width).toBeLessThanOrEqual(core);
      expect(t.height).toBeLessThanOrEqual(core);
      for (let y = t.y; y < t.y + t.height; y++) for (let x = t.x; x < t.x + t.width; x++) seen[y * W + x]! += 1;
    }
    expect(seen.every((n) => n === 1)).toBe(true);
    expect(tiles).toHaveLength(3 * 3);
  });

  it("handles an image smaller than one tile", () => {
    expect(tilesFor(50, 40, 112)).toEqual([{ x: 0, y: 0, width: 50, height: 40 }]);
  });
});

describe("upscale plan: bounded work for any input", () => {
  it("runs the model on the picture itself when ×4 stays small (best detail), then scales to the target", () => {
    expect(upscalePlan(800, 600, 2)).toEqual({ run: true, input: { width: 800, height: 600 }, output: { width: 1600, height: 1200 } });
  });

  it("shrinks a large picture first, so the model never works on more than 1536 px (×4 = 6144 px at most)", () => {
    const plan = upscalePlan(3000, 2000, 2);
    expect(plan).toMatchObject({ run: true, input: { width: 1536, height: 1024 }, output: { width: 4096, height: 2730 } });
    if (plan.run) expect(plan.input.width * 4).toBeGreaterThanOrEqual(plan.output.width);
  });

  it("does not run at all when the picture already has the largest size (a 4K result)", () => {
    expect(upscalePlan(4096, 2304, 2)).toEqual({ run: false });
    expect(upscalePlan(5000, 3000, 4)).toEqual({ run: false });
  });
});
