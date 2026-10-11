import { describe, expect, it } from "vitest";
import type { Branch } from "./services/branchService";
import { allowance, byKind, isWarehouse, kindWord, mayHaveMorePlaces, mayHaveMoreShops, hasSecondPlace, hasSecondShop } from "./places";

const place = (name: string, kind: "shop" | "warehouse"): Branch => ({
  id: name, name, kind, code: null, is_default: name === "Main", is_active: true, fills_orders: kind === "shop",
  address: null, phone: null, city_id: null, latitude: null, longitude: null,
});

describe("where stock could be, and where it could be sold", () => {
  it("a single shop with a warehouse allowed has somewhere else for stock — and still one counter", () => {
    const shop = { max_branches: 1, max_warehouses: 1 };

    expect(mayHaveMorePlaces(shop)).toBe(true);
    expect(mayHaveMoreShops(shop)).toBe(false);
  });

  it("a single shop with no warehouse allowed has neither", () => {
    expect(mayHaveMorePlaces({ max_branches: 1, max_warehouses: 0 })).toBe(false);
  });

  it("a server that does not say about warehouses is read as none", () => {
    expect(mayHaveMorePlaces({ max_branches: 1 })).toBe(false);
    expect(mayHaveMorePlaces({ max_branches: 3 })).toBe(true);
  });

  it("no ceiling is more than one, for either", () => {
    expect(mayHaveMoreShops({ max_branches: null })).toBe(true);
    expect(mayHaveMorePlaces({ max_branches: 1, max_warehouses: null })).toBe(true);
  });

  it("nothing is assumed before the shop's settings have arrived", () => {
    expect(mayHaveMorePlaces(undefined)).toBe(false);
    expect(mayHaveMoreShops(null)).toBe(false);
  });
});

describe("a place is a shop or a warehouse", () => {
  const list = [place("Main", "shop"), place("Godown", "warehouse"), place("Gulberg", "shop")];

  it("is split by kind, each half in the order it came", () => {
    const { shops, warehouses } = byKind(list);

    expect(shops.map((b) => b.name)).toEqual(["Main", "Gulberg"]);
    expect(warehouses.map((b) => b.name)).toEqual(["Godown"]);
  });

  it("a place that says nothing about its kind is a shop", () => {
    expect(isWarehouse({ kind: undefined as never })).toBe(false);
    expect(isWarehouse(null)).toBe(false);
    expect(kindWord(undefined)).toBe("branch");
    expect(kindWord("warehouse")).toBe("warehouse");
  });
});

describe("how many of a kind, against how many are allowed", () => {
  it("has room until the ceiling, and says both numbers", () => {
    expect(allowance(1, 3)).toMatchObject({ room: true, says: "1 of 3 used" });
    expect(allowance(3, 3)).toMatchObject({ room: false, says: "3 of 3 used" });
  });

  it("no ceiling always has room, and prints no made-up total", () => {
    expect(allowance(7, null)).toMatchObject({ room: true, says: "7" });
  });

  it("an allowance the server never sent is none at all", () => {
    expect(allowance(0, undefined)).toMatchObject({ room: false, says: "0 of 0 used" });
  });
});

/**
 * WHAT THE BUSINESS HAS, beside what it may have.
 *
 * Every plan allows a warehouse and most shops never have one. Read off the
 * allowance, a one-counter grocer was shown Stock by place, Stock transfers,
 * a Branch column that said "Main" all the way down and a "branch prices"
 * button with one branch in it. A second place existing is the switch.
 */
describe("a second place existing is the switch", () => {
  const has = (shops: number, warehouses: number) => ({ places: { shops, warehouses } });

  it("one shop and nothing else is one place, whatever its plan would allow", () => {
    expect(hasSecondPlace(has(1, 0))).toBe(false);
    expect(hasSecondShop(has(1, 0))).toBe(false);
  });

  it("a shop with a godown has somewhere else stock can be — and still one counter", () => {
    expect(hasSecondPlace(has(1, 1))).toBe(true);
    // The Branch column on a sales list is about counters, not shelves.
    expect(hasSecondShop(has(1, 1))).toBe(false);
  });

  it("two branches is both", () => {
    expect(hasSecondPlace(has(2, 0))).toBe(true);
    expect(hasSecondShop(has(2, 0))).toBe(true);
  });

  it("a server that does not send the count reads as one place — the quiet menu is the safe mistake", () => {
    expect(hasSecondPlace({})).toBe(false);
    expect(hasSecondPlace(null)).toBe(false);
    expect(hasSecondPlace(undefined)).toBe(false);
    expect(hasSecondShop({ places: null })).toBe(false);
  });
});

