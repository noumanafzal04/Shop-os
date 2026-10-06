import { describe, expect, it } from "vitest";

import { startingItemType } from "./startingItemType";

/**
 * "Add item" opens on the kind of thing THIS shop mostly adds.
 *
 * Found by the restaurant's journey: the form opened on Physical product in
 * a restaurant — stock tracked, at nought — because the rule only moved off
 * `physical_product` when a shop was not allowed it at all, and a restaurant
 * is. The lists below are the ones the server really sends
 * (`BusinessTypes::itemTypesFor`).
 */
describe("what Add item opens as", () => {
  it("a dish, in a restaurant — though a restaurant may also sell a bottle", () => {
    expect(startingItemType(["food_item", "physical_product", "deal"])).toBe("food_item");
  });

  it("a medicine, at a chemist's", () => {
    expect(startingItemType(["medicine", "physical_product"])).toBe("medicine");
  });

  it("a service, at a salon that also sells shampoo", () => {
    expect(startingItemType(["service", "physical_product"])).toBe("service");
  });

  it("a product, in a mart — where it always did", () => {
    expect(startingItemType(["physical_product", "deal"])).toBe("physical_product");
  });

  it("a product, when the shop's list has not arrived or is empty", () => {
    expect(startingItemType(undefined)).toBe("physical_product");
    expect(startingItemType(null)).toBe("physical_product");
    expect(startingItemType([])).toBe("physical_product");
  });
});
