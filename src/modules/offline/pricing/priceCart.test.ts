import { describe, expect, it } from "vitest";

import { priceCart, type PricedItem } from "./priceCart";

/**
 * "DO HAZAAR KA DAAL DO" — OFFLINE.
 *
 * The till's own engine has to reach the same figure the server will, and the
 * server binds the gross to the AMOUNT rather than recomputing it. If this
 * mirror got it wrong the till would queue a sale whose tender is six paisa
 * short of its own total, and the server would refuse it on sync — after the
 * fuel had been pumped and the customer had gone.
 */
describe("a line that names money", () => {
  const petrol: PricedItem = {
    id: "fuel",
    category_id: null,
    price: 268.5,
    discount_price: null,
    wholesale_price: null,
    price_tiers: null,
    tax_rate: 0,
    tax_group_rate: null,
  };

  it("is worth exactly the money, not the money recomputed", () => {
    // 2000 / 268.50 = 7.4487…, stored as 7.449 litres.
    // 7.449 × 268.50 = 2000.06 — the six paisa that must not appear.
    const out = priceCart(
      [{ item: petrol, quantity: 7.449, amountAsked: 2000 }],
      { default_tax_rate: 0, tax_inclusive: false },
    );

    expect(out.total).toBe(2000);
  });

  it("still prices by quantity when no money was named", () => {
    // The denominator: if amountAsked were ignored entirely, the case above
    // would pass on any build that also broke this one.
    const out = priceCart(
      [{ item: petrol, quantity: 7.449 }],
      { default_tax_rate: 0, tax_inclusive: false },
    );

    expect(out.total).toBe(2000.06);
  });

  it("takes a line discount off the money, not off the recomputed figure", () => {
    const out = priceCart(
      [{ item: petrol, quantity: 7.449, amountAsked: 2000, lineDiscount: 100 }],
      { default_tax_rate: 0, tax_inclusive: false },
    );

    expect(out.total).toBe(1900);
  });
});
