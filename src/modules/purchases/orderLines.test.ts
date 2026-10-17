import { describe, expect, it } from "vitest";

import { lineOut, orderables } from "./orderLines";

const WAISTCOAT = {
  id: "p-w", name: "Men's Waistcoat", cost: "2600.00",
  variants: [
    { id: "v-m", name: "M", cost: null, is_active: true },
    { id: "v-l", name: "L", cost: "2750.00", is_active: true },
    { id: "v-xxl", name: "XXL", cost: null, is_active: false },
  ],
};

describe("what an order can ask a supplier for", () => {
  it("a design in sizes is offered as its sizes, never as itself", () => {
    expect(orderables(WAISTCOAT).map((o) => [o.label, o.variant_id, o.cost])).toEqual([
      ["Men's Waistcoat / M", "v-m", 2600],
      ["Men's Waistcoat / L", "v-l", 2750],
    ]);
  });

  it("a plain item is offered as itself, with its packs", () => {
    const units = [{ id: "u", name: "Box", factor: 12 }] as never;
    expect(orderables({ id: "p-d", name: "Chiffon Dupatta", cost: 450, units })).toEqual([
      { key: "p-d:", product_id: "p-d", variant_id: null, label: "Chiffon Dupatta", cost: 450, units },
    ]);
  });

  it("a size line tells the server its size and never a pack", () => {
    expect(lineOut({ product_id: "p-w", variant_id: "v-m", product_unit_id: "u", quantity: 5, unit_cost: 2700 }))
      .toEqual({ product_id: "p-w", variant_id: "v-m", quantity: 5, unit_cost: 2700 });
    expect(lineOut({ product_id: "p-d", variant_id: null, product_unit_id: "u", quantity: 2, unit_cost: 5400 }))
      .toEqual({ product_id: "p-d", product_unit_id: "u", quantity: 2, unit_cost: 5400 });
  });
});
