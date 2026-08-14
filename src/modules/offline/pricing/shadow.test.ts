import { describe, expect, it } from "vitest";

import { comparePricing, type ServerTotals } from "./shadow";
import type { CartLine, PricedItem } from "./priceCart";

/**
 * The shadow check, which decides whether offline selling may ship.
 *
 * Its whole value rests on two properties, and both are easy to lose:
 *
 *  1. **Agreement means silence.** If it reported noise on carts that actually
 *     matched, two weeks of real trading would produce a pile nobody reads and
 *     the real disagreements would be lost inside it.
 *  2. **Comparison is EXACT.** A tolerance would be the wrong kindness — the
 *     claim being tested is agreement to the paisa, and "close enough" is
 *     precisely how a drawer drifts by a rupee a day.
 */

const item = (over: Partial<PricedItem> = {}): PricedItem => ({
  price: 100,
  discount_price: null,
  wholesale_price: null,
  price_tiers: null,
  tax_rate: 0,
  tax_group_rate: null,
  ...over,
});

const line = (over: Partial<CartLine> = {}): CartLine => ({
  item: item(),
  quantity: 1,
  ...over,
});

const shop = { default_tax_rate: 0, tax_inclusive: false };
const at = () => "2026-08-14T10:00:00.000Z";

const totals = (over: Partial<ServerTotals> = {}): ServerTotals => ({
  subtotal: 100,
  discount: 0,
  tax: 0,
  total: 100,
  ...over,
});

describe("agreement is silence", () => {
  it("says nothing when the engine matched the server", () => {
    expect(comparePricing("s1", [line()], shop, 0, totals(), at)).toBeNull();
  });

  it("says nothing on a cart with tax, a discount and several lines", () => {
    const lines = [
      line({ item: item({ price: 349.99, tax_rate: 17 }), quantity: 3 }),
      line({ item: item({ price: 75.5, tax_rate: 5 }), quantity: 7 }),
    ];
    // What the engine itself computes — the point is that a matching server
    // produces no report, not what the numbers are.
    const expected = totals({ subtotal: 1578.47, discount: 100, tax: 190.06, total: 1668.53 });

    const agreed = comparePricing("s1", lines, shop, 100, expected, at);
    // Recompute what the engine says and feed it back as "the server": a
    // correct comparator must then be silent.
    const local = agreed === null ? expected : agreed.local;

    expect(comparePricing("s1", lines, shop, 100, local, at)).toBeNull();
  });
});

describe("disagreement is reported in full", () => {
  it("names every figure that differs, and by how much", () => {
    const variance = comparePricing("s1", [line()], shop, 0, totals({ total: 105 }), at);

    expect(variance).not.toBeNull();
    expect(variance?.differences).toHaveLength(1);
    expect(variance?.differences[0]).toMatchObject({ field: "total", server: 105, local: 100, by: -5 });
  });

  it("reports several at once rather than stopping at the first", () => {
    // A tax bug moves both the tax and the total. Reporting one would send
    // somebody looking in the wrong place.
    const variance = comparePricing("s1", [line()], shop, 0, totals({ tax: 17, total: 117 }), at);

    expect(variance?.differences.map((d) => d.field).sort()).toEqual(["tax", "total"]);
  });

  it("carries the sale id, so the row can be looked up", () => {
    const variance = comparePricing("sale-99", [line()], shop, 0, totals({ total: 1 }), at);

    expect(variance?.saleId).toBe("sale-99");
    expect(variance?.at).toBe("2026-08-14T10:00:00.000Z");
  });

  it("carries enough of the cart to re-run it by hand", () => {
    // A variance nobody can reproduce is a variance nobody can fix.
    const variance = comparePricing(
      "s1",
      [
        line({
          item: item({ price: 250, discount_price: 199, tax_rate: 17, tax_group_rate: 18 }),
          quantity: 2.5,
          priceLevel: "wholesale",
          lineDiscountPct: 10,
        }),
      ],
      { default_tax_rate: 12, tax_inclusive: true },
      50,
      totals({ total: -1 }),
      at,
    );

    expect(variance?.cart.settings).toEqual({ default_tax_rate: 12, tax_inclusive: true });
    expect(variance?.cart.discount).toBe(50);
    expect(variance?.cart.lines[0]).toMatchObject({
      price: 250,
      discount_price: 199,
      tax_rate: 17,
      tax_group_rate: 18,
      quantity: 2.5,
      priceLevel: "wholesale",
      lineDiscountPct: 10,
    });
  });
});

describe("the comparison is exact", () => {
  it("reports a difference of a single paisa", () => {
    // The whole claim being tested is agreement to the paisa. A tolerance here
    // would hide exactly the class of bug this exists to find — a rounding
    // rule that is subtly wrong on values a shop rings all day.
    const variance = comparePricing("s1", [line()], shop, 0, totals({ total: 100.01 }), at);

    expect(variance).not.toBeNull();
    expect(variance?.differences[0].by).toBe(-0.01);
  });

  it("does not treat a rounding-sized gap as agreement", () => {
    expect(comparePricing("s1", [line()], shop, 0, totals({ tax: 0.005 }), at)).not.toBeNull();
  });
});

describe("numbers that are not really numbers", () => {
  it("does not file two infinities as agreement", () => {
    // The one shape where a plain `a === b` reports the OPPOSITE of the truth:
    // Infinity === Infinity is true, so both sides being off the scale would
    // read as "they matched". NaN needs no such help, since NaN === NaN is
    // already false — which is why the guard exists for this case and not that
    // one.
    const variance = comparePricing(
      "s1",
      [line({ item: item({ price: Infinity }) })],
      shop,
      0,
      totals({ subtotal: Infinity, total: Infinity }),
      at,
    );

    expect(variance, "two infinities must not read as a match").not.toBeNull();
    expect(variance?.differences.map((d) => d.field)).toContain("total");
  });
});

describe("a cart the engine cannot price at all", () => {
  it("is reported rather than swallowed", () => {
    // The most interesting possible result: the server priced it and the mirror
    // could not. It must be reported, and the describing of the cart must not
    // throw either — the cart most likely to break this is the one most worth
    // reporting.
    const exploding = {
      get item(): PricedItem {
        throw new Error("bad line");
      },
      quantity: 1,
    } as unknown as CartLine;

    const variance = comparePricing("s1", [exploding], shop, 0, totals(), at);

    expect(variance).not.toBeNull();
    expect(variance?.differences.length).toBe(4);
    expect(variance?.differences.every((d) => Number.isNaN(d.local))).toBe(true);
  });
});
