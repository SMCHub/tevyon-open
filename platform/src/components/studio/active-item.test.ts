import { describe, expect, it } from "vitest";
import { counter, nearestIndex, nextIndex, prevIndex } from "./active-item";

describe("slides in a loop", () => {
  it("steps forward and wraps from the last to the first", () => {
    expect(nextIndex(0, 4)).toBe(1);
    expect(nextIndex(3, 4)).toBe(0);
  });

  it("steps back and wraps from the first to the last", () => {
    expect(prevIndex(2, 4)).toBe(1);
    expect(prevIndex(0, 4)).toBe(3);
  });

  it("stays at 0 when there is nothing to step through", () => {
    expect(nextIndex(0, 0)).toBe(0);
    expect(prevIndex(0, 0)).toBe(0);
    expect(nextIndex(0, 1)).toBe(0);
  });

  it("labels the position with two digits, starting at one", () => {
    expect(counter(0, 4)).toBe("01 / 04");
    expect(counter(9, 12)).toBe("10 / 12");
  });
});

describe("row nearest to a line", () => {
  it("picks the row whose centre is closest to the line", () => {
    expect(nearestIndex([100, 300, 500], 320)).toBe(1);
    expect(nearestIndex([100, 300, 500], 900)).toBe(2);
    expect(nearestIndex([100, 300, 500], -50)).toBe(0);
  });

  it("keeps the earlier row on a tie, so the highlight does not flicker", () => {
    expect(nearestIndex([100, 300], 200)).toBe(0);
  });

  it("has no row when the list is empty", () => {
    expect(nearestIndex([], 100)).toBe(-1);
  });
});
