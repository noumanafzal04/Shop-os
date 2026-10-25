import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { catalogStock } from "./availability";

/**
 * A COUNTER SELLS WHAT ITS OWN PLACE HOLDS (wholesale #W2).
 *
 * 480 received into the godown, 120 moved to Main: the till's tile said 480,
 * and a cart of 150 went through to a refusal at Pay. `/products` sends both
 * figures — `stock_quantity` is the shop-wide rollup, `branch_stock` the
 * place's own — and the till read the rollup for an item without sizes.
 */
describe("the till's stock figure", () => {
  it("is the place's own, not the shop-wide total", () => {
    expect(catalogStock({ stock_quantity: "480.000", branch_stock: 120 })).toBe(120);
    // A place that holds none is none, not the rollup.
    expect(catalogStock({ stock_quantity: "480.000", branch_stock: 0 })).toBe(0);
    // Offline rows carry only the one figure the device was given.
    expect(catalogStock({ stock_quantity: 7 })).toBe(7);
  });

  it("is read through that rule on the till, never off the rollup", () => {
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");

    // The line that showed 480: a whole product's stock read straight off
    // `stock_quantity`. Any stock figure on the till goes through catalogStock.
    expect(till).not.toMatch(/onHand\(\s*Number\(\s*p\.stock_quantity/);
    expect(till).toMatch(/onHand\(catalogStock\(p\), stockDeltas, p\.id\)/);
  });
});

/**
 * KHATA IS OFFERED TO WHOEVER MAY SELL ON IT (wholesale #W6).
 *
 * The tender was gated on the shop's Customers module alone, so an order
 * booker with no right to read a dealer's account could charge it.
 */
describe("the khata tender at the till", () => {
  it("asks the person's permission, not only the shop's module", () => {
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");

    expect(till).toMatch(/const canSellOnKhata = hasKhata && hasPermission\("sales\.on_credit"\)/);
    expect(till).toMatch(/filter\(\(m\) => m !== "credit" \|\| canSellOnKhata\)/);
    expect(till).toMatch(/\{canSellOnKhata && <option value="credit">/);
    expect(till).not.toMatch(/m !== "credit" \|\| hasKhata/);
  });
});

/**
 * THE CHEAPER LIST, PICKED BY HAND, IS A DISCOUNT (wholesale #W7).
 *
 * An order booker with no discount permission switched a line to Wholesale
 * and sold at 525 instead of 545. The server refuses it; the till offers the
 * menu only to who may discount.
 */
describe("the price level menu at the till", () => {
  it("is offered only to who may discount", () => {
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");

    expect(till).toMatch(/\{hasWholesale && canDiscount && \(\s*<select value=\{l\.price_level/);
    expect(till).toMatch(/disabled=\{!hasWholesale \|\| !canDiscount\}/);
  });
});
