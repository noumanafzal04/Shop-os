import { describe as suite, expect, it } from "vitest";

import { describe, groupVariances } from "./groupVariances";
import type { ReportedVariance } from "./varianceService";

/**
 * Nine rows saying the same thing are one finding, not nine.
 *
 * Taken from the first real run of the shadow check, which produced exactly
 * that: nine carts, all missing the same 10% promotion, differing only in the
 * amount. Listed one per row a reader has to compare nine blocks of numbers
 * before noticing there is only one defect — and a shop trading all day would
 * produce nine hundred.
 */

let seq = 0;

const variance = (
  differences: Array<{ field: string; server: number; local: number; by: number }>,
): ReportedVariance => ({
  id: `v${(seq += 1)}`,
  sale_id: null,
  found_at: "2026-08-15T00:33:54.000Z",
  device: null,
  server: {},
  local: {},
  differences,
  cart: null,
});

/** A cart where the till missed a percentage discount — the real finding. */
const missedDiscount = (amount: number): ReportedVariance =>
  variance([
    { field: "discount", server: amount, local: 0, by: -amount },
    { field: "total", server: 1000 - amount, local: 1000, by: amount },
  ]);

suite("grouping", () => {
  it("folds carts with the same defect into one finding", () => {
    const groups = groupVariances([missedDiscount(106), missedDiscount(188), missedDiscount(80)]);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
  });

  it("keeps genuinely different defects apart", () => {
    // The dangerous version of this fix is one that folds everything into a
    // single row and hides the second problem.
    const groups = groupVariances([
      missedDiscount(106),
      variance([{ field: "tax", server: 17, local: 0, by: -17 }]),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("separates a till charging MORE from a till charging LESS", () => {
    // Same field, opposite consequence: one overcharges a customer and the
    // other gives the shop's money away. Merging them would hide whichever
    // was rarer.
    const groups = groupVariances([
      variance([{ field: "total", server: 900, local: 1000, by: 100 }]),
      variance([{ field: "total", server: 1000, local: 900, by: -100 }]),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("puts the commonest finding first", () => {
    // The shape that happened most is the one worth fixing first, and a long
    // tail of one-offs must not push it down the screen.
    const groups = groupVariances([
      variance([{ field: "tax", server: 17, local: 0, by: -17 }]),
      missedDiscount(106),
      missedDiscount(188),
    ]);

    expect(groups[0].fields).toContain("discount");
    expect(groups[0].count).toBe(2);
  });

  it("reports the range of money involved, not just a count", () => {
    // "9 carts" says how often; the money says how much it would have cost.
    const [group] = groupVariances([missedDiscount(80), missedDiscount(238), missedDiscount(106)]);

    expect(group.smallest).toBe(80);
    expect(group.largest).toBe(238);
  });

  it("keeps every cart, so any one of them can be reproduced", () => {
    const [group] = groupVariances([missedDiscount(80), missedDiscount(238)]);

    expect(group.examples).toHaveLength(2);
  });

  it("counts nothing when nothing disagreed", () => {
    expect(groupVariances([])).toEqual([]);
  });
});

suite("what the finding is called", () => {
  it("names the missed discount and which way it went wrong", () => {
    // "total: high" tells an owner nothing. Which way a CUSTOMER would have
    // been wrong is the thing they can act on.
    const [group] = groupVariances([missedDiscount(106)]);

    expect(describe(group)).toMatch(/no discount where the server did/);
    expect(describe(group)).toMatch(/charged more/);
  });

  it("names a tax disagreement as its own thing", () => {
    const [group] = groupVariances([variance([{ field: "tax", server: 17, local: 0, by: -17 }])]);

    expect(describe(group)).toMatch(/tax/i);
  });

  it("falls back to the direction when the fields are unfamiliar", () => {
    const [group] = groupVariances([
      variance([{ field: "total", server: 900, local: 1000, by: 100 }]),
    ]);

    expect(describe(group)).toMatch(/higher than the server/);
  });
});
