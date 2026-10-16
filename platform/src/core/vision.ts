/**
 * Image tools Tevyon runs itself (cut-out, upscale): the pure arithmetic around the models, without any model or
 * image library, so it is tested here and the server only feeds pixels through it (server/local-vision.ts).
 */

/** The largest side an upscale delivers: beyond it a result is too heavy to store, send and open (25 MP at ×4). */
export const UPSCALE_MAX_SIDE = 4096;

/**
 * The size an upscale delivers: the image times the factor, the long side capped at UPSCALE_MAX_SIDE with the shape
 * kept, and never smaller than the original (an image already above the cap stays as it is).
 */
export function upscaleSize(width: number, height: number, scale: 2 | 4): { width: number; height: number } {
  const long = Math.max(width, height);
  const target = Math.max(long, Math.min(long * scale, UPSCALE_MAX_SIDE));
  const f = target / long;
  return { width: Math.floor(width * f), height: Math.floor(height * f) };
}

export type Tile = { x: number; y: number; width: number; height: number };

/**
 * The tiles a model with a fixed input works through: a grid of cores at most `core` px wide that covers every pixel
 * exactly once. The model sees each core with some context around it (cut away again), so seams stay invisible.
 */
export function tilesFor(width: number, height: number, core: number): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += core) {
    for (let x = 0; x < width; x += core) {
      tiles.push({ x, y, width: Math.min(core, width - x), height: Math.min(core, height - y) });
    }
  }
  return tiles;
}

/** The largest side the upscale model works on: ×4 gives 6144 px, enough for any target up to UPSCALE_MAX_SIDE. */
export const UPSCALE_MAX_INPUT = 1536;

export type UpscalePlan =
  | { run: true; input: { width: number; height: number }; output: { width: number; height: number } }
  | { run: false };

/**
 * How an upscale runs, with bounded work for any picture: the model sees the picture itself when it is small (best
 * detail) or a copy shrunk to UPSCALE_MAX_INPUT on its long side, then the ×4 result is scaled to the target. A picture
 * that already has the largest size has nothing to gain: it does not run (and costs nothing).
 */
export function upscalePlan(width: number, height: number, scale: 2 | 4): UpscalePlan {
  const output = upscaleSize(width, height, scale);
  if (output.width === width && output.height === height) return { run: false };
  const long = Math.max(width, height);
  const f = long > UPSCALE_MAX_INPUT ? UPSCALE_MAX_INPUT / long : 1;
  return { run: true, input: { width: Math.round(width * f), height: Math.round(height * f) }, output };
}
