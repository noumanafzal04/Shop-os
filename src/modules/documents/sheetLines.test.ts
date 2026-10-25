import { describe, expect, it } from "vitest";

import { allCounted, documentLines, inPack, typedQuantity, unitPriceOf, type SheetLine } from "./sheetLines";

/**
 * A DISTRIBUTOR QUOTES IN CARTONS (wholesale #W4).
 *
 * The quotation sheet offered only − 1 +: fifteen cartons of twenty-four was
 * 359 taps, and no pack could be named although the document carries one.
 */
const oil: SheetLine = {
  key: "oil", product_id: "oil", variant_id: null, name: "Cooking Oil 1L", price: 545,
  tracks_serial: false, tax_rate: null, tax_group_rate: null, quantity: 1, serials: [],
  units: [
    { id: "c12", name: "Carton 12", factor: 12, price: 6400 },
    { id: "c24", name: "Carton 24", factor: 24, price: null },
  ],
  unitId: null,
};

describe("a line on a new quotation", () => {
  it("takes a typed quantity", () => {
    expect(typedQuantity([oil], "oil", "15")[0].quantity).toBe(15);
  });

  it("keeps the line while its box is cleared, and holds the sheet until it has a figure", () => {
    const cleared = typedQuantity([oil], "oil", "");
    expect(cleared).toHaveLength(1);
    expect(cleared[0].quantity).toBe(0);
    expect(allCounted(cleared)).toBe(false);
    expect(allCounted(typedQuantity(cleared, "oil", "3"))).toBe(true);
  });

  it("refuses nonsense as nought, not as a figure", () => {
    expect(typedQuantity([oil], "oil", "-4")[0].quantity).toBe(0);
    expect(typedQuantity([oil], "oil", "abc")[0].quantity).toBe(0);
  });

  it("is priced by the pack — its own price, or the piece price times the pack", () => {
    expect(unitPriceOf(inPack([oil], "oil", "c12")[0])).toBe(6400);
    expect(unitPriceOf(inPack([oil], "oil", "c24")[0])).toBe(545 * 24);
    expect(unitPriceOf(oil)).toBe(545);
  });

  it("names the pack to the server, and only when one is chosen", () => {
    const fifteenCartons = typedQuantity(inPack([oil], "oil", "c24"), "oil", "15");

    expect(documentLines(fifteenCartons)).toEqual([
      { product_id: "oil", variant_id: null, quantity: 15, product_unit_id: "c24" },
    ]);
    expect(documentLines([oil])[0]).not.toHaveProperty("product_unit_id");
  });
});
