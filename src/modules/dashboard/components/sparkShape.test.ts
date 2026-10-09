import { describe, expect, it } from "vitest";

import { condense, hasShape, MOST_BARS, pointsPerBar } from "./sparkShape";

/**
 * A period drawn as bars. Seven fit beside a figure; a month's thirty do not,
 * so neighbours are added together — and "added" is the part that matters:
 * the bars are takings, and they still have to come to the figure above them.
 */
describe("condense", () => {
  const sum = (points: number[]) => points.reduce((a, b) => a + b, 0);

  it("leaves a series alone when it already fits", () => {
    const week = [1, 2, 3, 4, 5, 6, 7];

    expect(condense(week)).toBe(week);
    expect(condense(Array.from({ length: MOST_BARS }, () => 1))).toHaveLength(MOST_BARS);
  });

  it("adds neighbours together, never averages them", () => {
    const month = Array.from({ length: 30 }, (_, i) => i + 1);
    const bars = condense(month);

    expect(bars).toHaveLength(10);
    // Still the same money.
    expect(sum(bars)).toBe(sum(month));
    // The last bar is the last three days: 28 + 29 + 30.
    expect(bars[9]).toBe(87);
  });

  it("leaves the OLDEST bar short, so the newest is a whole one", () => {
    // Thirty-one days, three to a bar: the first bar is the odd day out.
    const month = Array.from({ length: 31 }, () => 10);
    const bars = condense(month);

    expect(bars).toHaveLength(11);
    expect(bars[0]).toBe(10);
    expect(bars[10]).toBe(30);
  });

  it("never draws more bars than there is room for", () => {
    for (const length of [15, 28, 29, 30, 31, 53, 92, 366]) {
      expect(condense(Array.from({ length }, () => 1)).length, `${length} points`).toBeLessThanOrEqual(MOST_BARS);
    }
  });

  it("says how many points one bar stands for — the figure its caption prints", () => {
    expect(pointsPerBar(7)).toBe(1);
    expect(pointsPerBar(14)).toBe(1);
    expect(pointsPerBar(15)).toBe(2);
    expect(pointsPerBar(30)).toBe(3);
    // And the two agree: that many points to a bar is what condense drew.
    expect(condense(Array.from({ length: 30 }, () => 1))[9]).toBe(pointsPerBar(30));
  });

  it("a condensed run of nothing still has no shape", () => {
    expect(hasShape(condense(Array.from({ length: 30 }, () => 0)))).toBe(false);
  });
});
