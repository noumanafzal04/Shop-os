import { describe, expect, it } from "vitest";

import { draftTotal, fromOrderable, fromReorderItem, fromSupplierItem, lineAmount, lineIsWrong, withAdded, withQuantityForAll } from "./orderDraft";
import { orderables } from "./orderLines";
import type { SupplierItem } from "./types";

const rice: SupplierItem = {
  key: "p-rice:", product_id: "p-rice", variant_id: null, name: "Rice 5kg", sku: "RC5",
  units: [{ id: "u-bag", name: "Bag of 10", factor: 10 }],
  track_inventory: true, in_stock: 4, low_stock_threshold: 10, times_ordered: 3,
  last: { po_number: "PO-000007", ordered_on: "2026-10-08", quantity: 20, product_unit_id: "u-bag", unit_name: "Bag of 10", unit_cost: 1100 },
};

describe("a new order's lines", () => {
  it("start from last time's quantity, pack and cost when ticked on the supplier's list", () => {
    expect(fromSupplierItem(rice)).toMatchObject({ key: "p-rice:", label: "Rice 5kg", quantity: 20, unit_cost: 1100, product_unit_id: "u-bag" });
  });

  it("drop a pack the item no longer has", () => {
    expect(fromSupplierItem({ ...rice, units: [] }).product_unit_id).toBeNull();
  });

  it("are one line per item, however it was found", () => {
    const searched = fromOrderable(orderables({ id: "p-rice", name: "Rice 5kg", cost: 1000 })[0]);
    const lines = withAdded([fromSupplierItem(rice)], [searched, fromReorderItem({ id: "p-rice", name: "Rice 5kg", cost: 900 })]);

    expect(lines).toHaveLength(1);
    // The line already there keeps what somebody chose for it.
    expect(lines[0].quantity).toBe(20);
  });

  it("take one quantity for all of them, and refuse a quantity that is none", () => {
    const two = withAdded([fromSupplierItem(rice)], [fromReorderItem({ id: "p-sugar", name: "Sugar", cost: 50 })]);

    expect(withQuantityForAll(two, 12).map((l) => l.quantity)).toEqual([12, 12]);
    expect(withQuantityForAll(two, 0)).toBe(two);
    expect(withQuantityForAll(two, Number.NaN)).toBe(two);
  });

  it("add up to the paisa", () => {
    const lines = [
      { ...fromReorderItem({ id: "a", name: "A", cost: 0.1 }), quantity: 3 },
      { ...fromReorderItem({ id: "b", name: "B", cost: 333.33 }), quantity: 3 },
    ];

    expect(lineAmount(lines[0])).toBe(0.3);
    expect(draftTotal(lines)).toBe(1000.29);
  });

  it("say which line the server would refuse", () => {
    expect(lineIsWrong({ quantity: 0, unit_cost: 10 })).toBe(true);
    expect(lineIsWrong({ quantity: 2, unit_cost: -1 })).toBe(true);
    expect(lineIsWrong({ quantity: 2, unit_cost: 0 })).toBe(false);
  });
});
