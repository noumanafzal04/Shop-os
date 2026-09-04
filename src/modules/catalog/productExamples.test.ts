import { describe, expect, it } from "vitest";

import { GENERIC_PRODUCT_EXAMPLE, productExampleFor } from "./productExamples";
import { TRADE_FEATURES } from "../../test/tradeFeatures";

/**
 * A placeholder is only worth having if it is RIGHT for the shop reading it.
 *
 * The failure this guards is not a crash — an unknown trade falls back and the
 * form still works. It is a shop opening the product form and being shown
 * somebody else's trade, which is exactly the complaint that started this:
 * "input title Shirt like this tarhan ka aa raha hai."
 *
 * So the denominator is the trade list itself, read from the same table the
 * module matrix uses. Adding a ninth business type turns this red rather than
 * quietly giving it a T-shirt.
 */
describe("the product name example", () => {
  it("has one for every trade the shop can be", () => {
    for (const trade of Object.keys(TRADE_FEATURES)) {
      expect(
        productExampleFor(trade),
        `${trade} has no product example of its own`,
      ).not.toBe(GENERIC_PRODUCT_EXAMPLE);
    }
  });

  it("gives each trade a DIFFERENT example where the trades differ", () => {
    // Not a uniqueness rule — a chemist and a pharmacy-shaped clinic should
    // share one. But a table that answered the same thing for a tyre shop and
    // a restaurant would pass the check above while teaching nothing.
    const shown = new Set(Object.keys(TRADE_FEATURES).map((t) => productExampleFor(t)));

    expect(shown.size).toBeGreaterThanOrEqual(6);
  });

  it("lets the item type win, because the shop already said what it is", () => {
    // A tyre shop billing a fitting charge is adding a SERVICE, and "Tyre
    // 185/65 R15" would be the wrong shape for that field.
    expect(productExampleFor("automotive", "service")).toBe("Haircut");
    expect(productExampleFor("mart", "medicine")).toBe("Cough syrup 120ml");
  });

  it("falls back rather than showing nothing to a shop it does not know", () => {
    expect(productExampleFor(null)).toBe(GENERIC_PRODUCT_EXAMPLE);
    expect(productExampleFor("something-new")).toBe(GENERIC_PRODUCT_EXAMPLE);
  });

  it("never names a brand", () => {
    // These read as an endorsement inside software the shop pays for, and two
    // of them are somebody's trademark.
    const brands = /panadol|sufi|dalda|coca|pepsi|nestle|bridgestone|shell/i;

    for (const trade of Object.keys(TRADE_FEATURES)) {
      expect(productExampleFor(trade)).not.toMatch(brands);
    }
    for (const type of ["service", "medicine", "food_item", "deal"]) {
      expect(productExampleFor("retail", type)).not.toMatch(brands);
    }
  });
});
