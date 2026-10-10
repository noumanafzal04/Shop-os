import { describe, expect, it } from "vitest";

import { priceChanges, priceTyped } from "./priceChanges";

describe("what a save of the add-on price list says", () => {
  it("says the one box that was typed in, and not the ones that were only shown", () => {
    // Products at 25,000 was on the list when this screen loaded it. Pricing
    // Bank Card Offers is not a statement about Products.
    expect(priceChanges({ products: 25000 }, { products: "25000", bank_offers: "350" })).toEqual({ bank_offers: 350 });
  });

  it("does not name a module this screen never had a box value for", () => {
    // Somebody else priced Delivery after this screen loaded. It is not in
    // `saved` or `typed` here, so it is not in what is sent — and stays.
    const sent = priceChanges({ customers: 500 }, { customers: "700" });

    expect(sent).toEqual({ customers: 700 });
    expect("delivery" in sent).toBe(false);
  });

  it("a box cleared takes that price off — said as null, not left unsaid", () => {
    expect(priceChanges({ products: 25000, customers: 500 }, { products: "", customers: "500" })).toEqual({ products: null });
    expect(priceChanges({ products: 25000 }, { products: "0" })).toEqual({ products: null });
    expect(priceChanges({ products: 25000 }, {})).toEqual({ products: null });
  });

  it("nothing typed is nothing to save", () => {
    expect(priceChanges({ products: 25000 }, { products: "25000" })).toEqual({});
    expect(priceChanges({ products: 25000 }, { products: " 25000 " })).toEqual({});
    // A box visited and left blank, for a module that had no price.
    expect(priceChanges({}, { delivery: "" })).toEqual({});
    expect(priceChanges({}, { delivery: "0" })).toEqual({});
  });

  it("half a number is not a price", () => {
    expect(priceChanges({}, { delivery: "abc" })).toEqual({});
    expect(priceChanges({ delivery: 300 }, { delivery: "-5" })).toEqual({ delivery: null });
    // A minus typed where there was no price is not a change to anything.
    expect(priceChanges({}, { delivery: "-5" })).toEqual({});
    expect(priceTyped("12.50")).toBe(12.5);
    expect(priceTyped(undefined)).toBe(0);
  });
});
