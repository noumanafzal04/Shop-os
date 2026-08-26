import { describe, expect, it } from "vitest";

import { onSale, sellingPrice } from "./pricing";

describe("sellingPrice", () => {
  it("takes the sale price when there is a real one", () => {
    expect(sellingPrice({ price: "500", discount_price: "400" })).toBe(400);
  });

  it("ignores a sale price that is not a reduction", () => {
    // A shop that raises its regular price and forgets to clear an old
    // promotion would otherwise be charging the old, HIGHER figure as if it
    // were a discount.
    expect(sellingPrice({ price: "500", discount_price: "600" })).toBe(500);
    expect(sellingPrice({ price: "500", discount_price: "500" })).toBe(500);
  });

  it("treats zero and null as no sale rather than as free", () => {
    // The one that matters: a `0` discount_price read literally gives the
    // product away, and a column defaulting to 0 is a very ordinary thing.
    expect(sellingPrice({ price: "500", discount_price: "0" })).toBe(500);
    expect(sellingPrice({ price: "500", discount_price: null })).toBe(500);
    expect(sellingPrice({ price: "500" })).toBe(500);
  });

  it("reads numbers and the strings a decimal column returns", () => {
    expect(sellingPrice({ price: 500, discount_price: 400 })).toBe(400);
    expect(sellingPrice({ price: "500.00", discount_price: "449.50" })).toBe(449.5);
  });
});

describe("onSale", () => {
  it("is true only where the buyer actually pays less", () => {
    expect(onSale({ price: "500", discount_price: "400" })).toBe(true);
    expect(onSale({ price: "500", discount_price: "600" })).toBe(false);
    expect(onSale({ price: "500", discount_price: "0" })).toBe(false);
    expect(onSale({ price: "500" })).toBe(false);
  });
});
