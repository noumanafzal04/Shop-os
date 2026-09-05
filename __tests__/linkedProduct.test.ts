import { productBelongsToShop } from "../src/modules/marketplace/linkedProduct";

/**
 * The boundary a shared link crosses. See `linkedProduct.ts` for why the shop
 * and the item in one URL are two unrelated claims until something checks.
 */
describe("productBelongsToShop", () => {
  it("opens an item the linked shop actually sells", () => {
    expect(productBelongsToShop({ shop: { slug: "burger-hut" } }, "burger-hut")).toBe(true);
  });

  it("refuses an item belonging to a different shop", () => {
    expect(productBelongsToShop({ shop: { slug: "kebab-corner" } }, "burger-hut")).toBe(false);
  });

  // Each of these once read as "no reason to stop" in a check written as
  // `product.shop?.slug !== slug`, which is false for undefined !== undefined.
  it.each([
    ["no shop on the payload", { shop: undefined }],
    ["an explicitly null shop", { shop: null }],
    ["a shop with no slug", { shop: { slug: null } }],
  ])("refuses %s", (_label, product) => {
    expect(productBelongsToShop(product, "burger-hut")).toBe(false);
  });

  it.each([
    ["no product yet", undefined, "burger-hut"],
    ["no shop to compare against", { shop: { slug: "burger-hut" } }, undefined],
    // The case that makes the early return load-bearing rather than tidy:
    // written as one optional chain, this compares undefined with undefined,
    // says they match, and opens a sheet for nothing on a screen for nowhere.
    // Both halves of a half-loaded screen are absent AT THE SAME TIME, which
    // is the ordinary first render, not an edge case.
    ["neither, mid-load", undefined, undefined],
  ] as const)("refuses when there is %s", (_label, product, slug) => {
    expect(productBelongsToShop(product, slug)).toBe(false);
  });

  it("is case- and whitespace-exact, because a slug is an identifier", () => {
    expect(productBelongsToShop({ shop: { slug: "Burger-Hut" } }, "burger-hut")).toBe(false);
    expect(productBelongsToShop({ shop: { slug: "burger-hut " } }, "burger-hut")).toBe(false);
  });
});
