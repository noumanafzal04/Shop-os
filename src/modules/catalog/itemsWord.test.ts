import { describe, expect, it } from "vitest";

import { allItemsWord, itemsWord } from "./itemsWord";

describe("what a business calls the things it sells", () => {
  it("a shop with a shelf has products", () => {
    expect(itemsWord({ products: true })).toBe("Products");
    expect(allItemsWord({ products: true })).toBe("All products");
  });

  it("a salon has services, and is not told about products it does not sell", () => {
    expect(itemsWord({ services: true })).toBe("Services");
    expect(allItemsWord({ services: true })).toBe("All services");
  });

  it("a workshop that fits parts and charges labour has both", () => {
    expect(itemsWord({ products: true, services: true })).toBe("Products & services");
    expect(allItemsWord({ products: true, services: true })).toBe("All items");
  });

  it("a switched-off module is not a module", () => {
    expect(itemsWord({ products: true, services: false })).toBe("Products");
    expect(itemsWord(undefined)).toBe("Products");
  });
});
