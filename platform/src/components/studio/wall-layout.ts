/**
 * Layout of the studio walls (wall.tsx, used by the image and the video studio): tiles in staggered columns like an
 * editorial work page, each tile numbered, its title set as giant split letters. Pure functions; the browser only
 * measures the wall's width.
 */

/** As many columns of at least `min` px as fit into a wall `width` px wide (gaps of `gap`), one to `max`. */
export function columnsFor(width: number, min: number, gap = 24, max = 4): number {
  return Math.min(max, Math.max(1, Math.floor((width + gap) / (min + gap))));
}

/**
 * Tiles into columns: each tile goes to the column holding the least so far (the left one on a tie), so the first row
 * reads 1, 2, 3 and the numbers keep running along the rows. Heights and gap are in column widths (height / width).
 * The stagger of every second column is drawn by CSS only and left out here, or the first row would read 1, 3, 2.
 */
export function distribute(heights: number[], cols: number, { gap = 0.06 }: { gap?: number } = {}): number[][] {
  const n = Math.max(1, Math.floor(cols));
  const columns: number[][] = Array.from({ length: n }, () => []);
  const ends: number[] = Array.from({ length: n }, () => 0);
  heights.forEach((h, i) => {
    let best = 0;
    for (let c = 1; c < n; c++) if (ends[c]! < ends[best]!) best = c;
    columns[best]!.push(i);
    ends[best]! += h + gap;
  });
  return columns;
}

/** “007”: a tile's number with as many digits as the count needs, at least two. */
export function tileNo(i: number, total: number): string {
  return String(i + 1).padStart(Math.max(2, String(total).length), "0");
}

/** Title type of a tile: short names split into rows of letter cells, longer ones as plain lines. */
export type PosterType = { kind: "split"; rows: string[][] } | { kind: "lines"; lines: string[] };

const MAX_SPLIT = 12;
const LINE_CHARS = 10;
const MAX_LINES = 3;

/**
 * A title as poster type. Up to twelve letters (no hyphen, no slash) are split into rows of three, a row as two cells
 * “AN T / HR A / ZI T”; a lone last letter is avoided (four letters make “LÖ / W E”). Longer titles, and the ones with
 * a hyphen or slash, are set as up to three plain lines broken at words and after hyphens.
 */
export function posterType(title: string): PosterType {
  const upper = title.toLocaleUpperCase("en-US").trim();
  const letters = upper.replace(/[^\p{L}\p{N}]/gu, "");
  if (/[-/]/.test(upper) || letters.length > MAX_SPLIT) return { kind: "lines", lines: lines(upper) };

  const n = letters.length;
  const count = Math.ceil(n / 3);
  const sizes = Array.from({ length: count }, (_, i) => (i < count - 1 ? 3 : n - 3 * i));
  if (sizes.length > 1 && sizes[sizes.length - 1] === 1) {
    sizes[sizes.length - 2] = 2;
    sizes[sizes.length - 1] = 2;
  }
  let at = 0;
  const rows = sizes.map((size, r) => {
    const part = letters.slice(at, (at += size));
    if (size === 3) return [part.slice(0, 2), part.slice(2)];
    return size === 2 && r % 2 === 1 ? [part[0]!, part[1]!] : [part];
  });
  return { kind: "split", rows };
}

/** Words (a slash joins the word before it, a hyphen ends its part) packed greedily into short lines. */
function lines(upper: string): string[] {
  const tokens: string[] = [];
  for (const word of upper.split(/\s+/).filter(Boolean)) {
    if (word === "/" && tokens.length) tokens[tokens.length - 1] += " /";
    else tokens.push(...word.split(/(?<=-)/));
  }
  const out: string[] = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    const joined = last === undefined ? t : last.endsWith("-") ? last + t : `${last} ${t}`;
    if (last !== undefined && joined.length <= LINE_CHARS) out[out.length - 1] = joined;
    else out.push(t);
  }
  return out.length > MAX_LINES ? [...out.slice(0, MAX_LINES - 1), out.slice(MAX_LINES - 1).join(" ")] : out;
}
