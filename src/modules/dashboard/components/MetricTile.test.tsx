import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { MetricTile } from "./MetricTile";

/**
 * The filled card at the head of the strip draws the week as BARS, and the
 * bars have to tell the truth: today is the solid one, a day of nothing is
 * not drawn like a day of something, and a week of nothing draws no week.
 */
const bars = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[aria-hidden] > span[style]"));

const tile = (spark: number[] | undefined) =>
  render(<MetricTile label="Today's Sales" value="Rs 3,020" icon={<i />} featured spark={spark} />);

describe("the week behind today's figure", () => {
  it("is one bar a day, tallest for the best day, and today's is the solid one", () => {
    const { container } = tile([1000, 0, 2500, 5000, 0, 1500, 3020]);
    const drawn = bars(container);

    expect(drawn).toHaveLength(7);
    expect(drawn[3].style.height).toBe("100%");
    expect(drawn[2].style.height).toBe("50%");
    // Today — the last — is the only solid one.
    expect(drawn.map((b) => b.className.includes("bg-white/35"))).toEqual([true, true, true, true, true, true, false]);
  });

  it("does not draw a day that took nothing like a day that took a little", () => {
    const { container } = tile([0, 20, 5000]);
    const [nothing, little] = bars(container);

    expect(nothing.style.height).toBe("4%");
    // 20 of 5,000 is 0.4% — invisible. It is given a sliver, and a taller
    // one than nothing gets.
    expect(little.style.height).toBe("8%");
  });

  it("draws no week when there was no week", () => {
    // Seven equal stubs would read as seven equal days.
    expect(bars(tile([0, 0, 0, 0, 0, 0, 0]).container)).toHaveLength(0);
    expect(bars(tile(undefined).container)).toHaveLength(0);
  });

  it("still says the figure and what it is", () => {
    const { getByText } = tile([1, 2, 3]);

    expect(getByText("Rs 3,020")).toBeInTheDocument();
    expect(getByText("Today's Sales")).toBeInTheDocument();
  });
});
