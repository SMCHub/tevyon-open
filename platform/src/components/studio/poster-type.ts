/**
 * Poster type for any title: the name in capitals, broken into chunks on staggered rows like a brand poster
 * (each word its own row, cut in two; long titles join their shortest neighbours), plus the italic line in two parts.
 * Pure, so a new preset or model gets its poster without anyone writing it by hand.
 */

/** One row of the giant title: its chunks (a gap between them) and how far it steps in, in em. */
export type TitleRow = { chunks: string[]; indent: number };
export type SplitTitle = { rows: TitleRow[]; width: number };

const MAX_ROWS = 4;
/** How far each row steps in (em), so the rows stagger. */
const INDENT = [0, 0.9, 0.35, 1.3];
/** The break between a row's chunks (em). */
const GAP = 0.3;
const NARROW = new Set([..."I!.,:;'’-1J|"]);
const WIDE = new Set([..."WM"]);

/** Rough width of a capital in Funnel Display at tight tracking, in em. Good enough to fit the type to its box. */
function glyphWidth(c: string): number {
  if (NARROW.has(c)) return 0.3;
  if (WIDE.has(c)) return 0.88;
  return 0.64;
}

/** A word in two: short words after two letters, longer ones in the middle. One or two letters stay whole. */
function cut(word: string): string[] {
  const letters = [...word];
  if (letters.length <= 2) return [word];
  const at = letters.length <= 4 ? 2 : Math.ceil(letters.length / 2);
  return [letters.slice(0, at).join(""), letters.slice(at).join("")];
}

const letterCount = (s: string) => [...s.replace(/\s+/g, "")].length;

/** Breaks a title into staggered rows of chunks and measures the widest row (em), for fitting it to its box. */
export function splitTitle(title: string): SplitTitle {
  const words = title.toUpperCase().trim().split(/\s+/).filter(Boolean).flatMap((w) => w.split(/(?<=-)(?=.)/));
  if (words.length === 0) return { rows: [], width: 0 };

  // Too many rows: join the neighbours with the fewest letters (the first such pair on a tie).
  const lines = [...words];
  while (lines.length > MAX_ROWS) {
    let best = 0;
    for (let i = 1; i < lines.length - 1; i++) {
      if (letterCount(lines[i]!) + letterCount(lines[i + 1]!) < letterCount(lines[best]!) + letterCount(lines[best + 1]!)) best = i;
    }
    lines.splice(best, 2, `${lines[best]} ${lines[best + 1]}`);
  }

  const rows = lines.map((line, r): TitleRow => {
    const parts = line.split(" ");
    const chunks = parts.length > 1 ? [parts[0]!, parts.slice(1).join(" ")] : cut(line);
    return { chunks, indent: INDENT[r % INDENT.length]! };
  });
  const rowWidth = (row: TitleRow) =>
    row.indent + row.chunks.reduce((w, c) => w + [...c].reduce((s, ch) => s + (ch === " " ? GAP : glyphWidth(ch)), 0), 0) + (row.chunks.length - 1) * GAP;
  const width = Math.round(Math.max(...rows.map(rowWidth)) * 100) / 100;
  return { rows, width };
}

/**
 * A line in two parts for the italic stamp: after the comma nearest the middle when there is one in the middle half,
 * otherwise at the space nearest the middle. A single word stays on the first line.
 */
export function twoLines(text: string): [string, string] {
  const t = text.trim();
  const mid = t.length / 2;
  const nearest = (re: RegExp, within: (i: number) => boolean) => {
    let best = -1;
    for (const m of t.matchAll(re)) {
      const i = m.index;
      if (within(i) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    }
    return best;
  };
  const comma = nearest(/,/g, (i) => i >= t.length * 0.25 && i <= t.length * 0.75);
  if (comma >= 0) return [t.slice(0, comma + 1), t.slice(comma + 1).trim()];
  const space = nearest(/ /g, () => true);
  if (space < 0) return [t, ""];
  return [t.slice(0, space), t.slice(space + 1)];
}
