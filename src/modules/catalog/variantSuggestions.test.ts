import { describe, expect, it } from "vitest";

import { valueSuggestions } from "./variantSuggestions";

/**
 * A tyre shop typed "Size" and was offered "+ S / M / L / XL". A chip is one
 * tap, so a wrong one is worse than none: it reads as software built for
 * somebody else's shop.
 */
describe("the one-tap values under what varies", () => {
  it("gives a tyre shop tyre sizes, not a shirt's", () => {
    const tyre = valueSuggestions("Size", { trade: "automotive" });

    expect(tyre).toContain("185/65 R15");
    expect(tyre).not.toContain("XL");
  });

  it("keeps a shirt's sizes for a clothing shop and a dish's for a kitchen", () => {
    expect(valueSuggestions("Size", { trade: "retail" })).toEqual(["S", "M", "L", "XL", "XXL"]);
    expect(valueSuggestions("size", { isFood: true, trade: "food" })).toEqual(["Small", "Medium", "Large"]);
  });

  it("offers a phone shop its storage", () => {
    expect(valueSuggestions("Storage", { trade: "retail" })).toContain("128GB");
  });

  it("guesses nothing where a guess would be wrong", () => {
    // A shop's colours and a laptop's models are its own.
    expect(valueSuggestions("Colour", { trade: "retail" })).toEqual([]);
    expect(valueSuggestions("Model", { trade: "retail" })).toEqual([]);
  });
});
