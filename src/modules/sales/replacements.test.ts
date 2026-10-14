import { describe, expect, it } from "vitest";

import type { ProductVariant } from "../catalog/types";
import { changed, differenceOf, linesOut, offersOf, taken, type Replacement } from "./replacements";

/**
 * A kurta in three sizes, the Large dearer and the Medium sold through — the
 * rail the clothing journey (stage T) lives on.
 */
const size = (name: string, price: number, stock: number, more: Partial<ProductVariant> = {}): ProductVariant => ({
  id: `v-${name}`, name, sku: null, price, cost: null, stock_quantity: stock, low_stock_threshold: null, is_active: true, ...more,
});
const KURTA = {
  id: "p-kurta", name: "Lawn Kurta", type: "product" as const, price: 2500, discount_price: null, track_inventory: true,
  tax_rate: 5, tax_group_rate: null, stock_quantity: 0,
  variants: [size("S", 2500, 4), size("M", 2500, 0), size("L", 2700, 3)],
};
const BELT = { id: "p-belt", name: "Belt", type: "product" as const, price: 900, discount_price: 750, track_inventory: true, tax_rate: null, stock_quantity: 6 };

describe("what a product offers to an exchange", () => {
  it("a design in sizes offers each size and never the design on its own", () => {
    const offers = offersOf(KURTA);

    expect(offers.map((o) => o.name)).toEqual(["Lawn Kurta (S)", "Lawn Kurta (M)", "Lawn Kurta (L)"]);
    expect(offers.every((o) => o.variant_id !== null), "the design itself was offered — the server refuses it").toBe(true);
    // Each at its OWN price, not the design's.
    expect(offers.map((o) => o.price)).toEqual([2500, 2500, 2700]);
    // Two sizes of one design are two different things.
    expect(new Set(offers.map((o) => o.key)).size).toBe(3);
  });

  it("a size priced as its design goes out at the design's sale price", () => {
    // Exchanged INTO a size on sale, the customer pays what the till charges.
    const onSale = { ...KURTA, price: 5490, discount_price: 4990, variants: [size("M", 5490, 3), size("XL", 5990, 3)] };

    expect(offersOf(onSale).map((o) => o.price)).toEqual([4990, 5990]);
  });

  it("says how many of each are left, and why the one that is gone cannot go", () => {
    const [small, medium, large] = offersOf(KURTA);

    expect([small.left, medium.left, large.left]).toEqual([4, 0, 3]);
    expect(small.whyNot).toBeNull();
    expect(medium.whyNot).toBe("Lawn Kurta — M is out of stock");
  });

  it("a size switched off is not offered at all, and one sold out for the day says so", () => {
    const offers = offersOf({ ...KURTA, variants: [size("S", 2500, 4, { is_active: false }), size("L", 2700, 3, { sold_out_at: "2026-10-11T10:00:00Z" })] });

    expect(offers.map((o) => o.name)).toEqual(["Lawn Kurta (L)"]);
    expect(offers[0].whyNot).toBe("Lawn Kurta — L is sold out.");
  });

  it("a plain product offers itself, at its sale price where it has one", () => {
    expect(offersOf(BELT)).toEqual([
      { key: "p-belt", product_id: "p-belt", variant_id: null, name: "Belt", price: 750, tracks_serial: false, tax_rate: null, tax_group_rate: null, left: 6, whyNot: null },
    ]);
  });

  it("a service has no shelf to count", () => {
    expect(offersOf({ id: "s", name: "Alteration", type: "service", price: 300, discount_price: null, track_inventory: false })[0].left).toBeNull();
  });
});

describe("the list of what is going out", () => {
  const [small, medium, large] = offersOf(KURTA);

  it("the same size tapped twice is two of it; another size is another row", () => {
    let rows: Replacement[] = [];
    rows = taken(rows, large);
    rows = taken(rows, large);
    rows = taken(rows, small);

    expect(rows.map((r) => [r.name, r.quantity])).toEqual([["Lawn Kurta (L)", 2], ["Lawn Kurta (S)", 1]]);
  });

  it("what cannot be handed over is not added", () => {
    expect(taken([], medium)).toEqual([]);
  });

  it("one fewer of the last one takes the row off", () => {
    const rows = taken(taken([], large), small);

    expect(changed(rows, large.key, 1).find((r) => r.key === large.key)?.quantity).toBe(2);
    expect(changed(rows, large.key, -1).map((r) => r.name)).toEqual(["Lawn Kurta (S)"]);
  });

  it("the SIZE is sent — the one thing the server asks for and was never told", () => {
    const rows = taken(taken([], large), offersOf(BELT)[0]);

    expect(linesOut(rows)).toEqual([
      { product_id: "p-kurta", variant_id: "v-L", quantity: 1 },
      { product_id: "p-belt", quantity: 1 },
    ]);
  });

  it("numbers go with the units that have them, and only as many as there are units", () => {
    const phone = offersOf({ id: "p-phone", name: "Phone", type: "product", price: 50000, discount_price: null, track_inventory: true, tracks_serial: true, stock_quantity: 3 })[0];
    const rows = taken([], phone).map((r) => ({ ...r, serials: [" 3567 ", "9999", ""] }));

    expect(linesOut(rows)).toEqual([{ product_id: "p-phone", quantity: 1, serials: ["3567"] }]);
  });
});

describe("what is left to settle", () => {
  it("the Medium back for a Large is 210 to collect; a Large back for a Medium is 210 to hand over", () => {
    // Back: 2,500 + 125 = 2,625.  Out: 2,700 + 135 = 2,835.
    expect(differenceOf(2835, 2625)).toBe(210);
    expect(differenceOf(2625, 2835)).toBe(-210);
    expect(differenceOf(2625, 2625)).toBe(0);
  });
});
