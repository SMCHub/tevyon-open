/** The slide after `i` in a loop of `count`, back to the first after the last. */
export function nextIndex(i: number, count: number): number {
  return count > 0 ? (i + 1) % count : 0;
}

/** The slide before `i` in a loop of `count`, on to the last before the first. */
export function prevIndex(i: number, count: number): number {
  return count > 0 ? (i - 1 + count) % count : 0;
}

/** Position for a slider's bar, "01 / 04". */
export function counter(i: number, count: number): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(i + 1)} / ${two(count)}`;
}

/**
 * The row whose centre lies closest to a line (e.g. the middle of the viewport), -1 without rows. On a tie the earlier
 * row wins, so a highlight does not flicker between two rows while scrolling.
 */
export function nearestIndex(centers: number[], y: number): number {
  let best = -1;
  let gap = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(c - y);
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  return best;
}
