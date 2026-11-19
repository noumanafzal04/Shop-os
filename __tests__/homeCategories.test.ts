import { homeCategoryTiles } from "../src/modules/marketplace/homeCategories";

/** THE HOME ROW OPENS A TRADE INTO THE KINDS OF SHOP INSIDE IT. */
const trade = (type: string, label: string, shops: number, cats: Array<[string, string, number]> = []) => ({
  type,
  label,
  shops_count: shops,
  categories: cats.map(([value, l, n]) => ({ value, label: l, shops_count: n })),
});

describe("the home category row", () => {
  it("shows categories instead of their trade, busiest first", () => {
    const tiles = homeCategoryTiles(
      [
        trade("food", "Food", 4, [["restaurant", "Restaurant", 2], ["fast_food", "Fast Food", 1], ["bakery", "Bakery", 1], ["cafe", "Cafe", 0]]),
        trade("retail", "Retail", 2, [["garments", "Garments", 2]]),
      ],
      10,
    );
    expect(tiles.map((t) => t.label)).toEqual(["Garments", "Restaurant", "Bakery", "Fast Food"]);
    expect(tiles.find((t) => t.label === "Fast Food")).toMatchObject({ trade: "food", value: "fast_food" });
  });

  it("keeps the trade's own tile for shops that chose no category", () => {
    const tiles = homeCategoryTiles([trade("retail", "Retail", 3, [["garments", "Garments", 2]])], 10);
    expect(tiles).toEqual([
      { key: "retail:garments", label: "Garments", shops: 2, trade: "retail", value: "garments" },
      { key: "retail", label: "Retail", shops: 1, trade: "retail", value: null },
    ]);
  });

  it("falls back to the trade when no shop chose any category", () => {
    const tiles = homeCategoryTiles([trade("mart", "Mart & Grocery", 4, [["grocery", "Grocery", 0]])], 10);
    expect(tiles).toEqual([{ key: "mart", label: "Mart & Grocery", shops: 4, trade: "mart", value: null }]);
  });

  it("drops trades with no shops, and caps the row", () => {
    const tiles = homeCategoryTiles(
      [trade("auto", "Auto", 0, [["tyre_shop", "Tyres", 0]]), ...["a", "b", "c", "d"].map((x, i) => trade(x, x.toUpperCase(), i + 1))],
      2,
    );
    expect(tiles.map((t) => t.key)).toEqual(["d", "c"]);
  });

  it("survives what a server might send", () => {
    expect(homeCategoryTiles([], 8)).toEqual([]);
    expect(homeCategoryTiles([{ type: "x", label: "X", shops_count: 1 } as never], 8)).toHaveLength(1);
    expect(homeCategoryTiles([trade("x", "X", 1)], 0)).toEqual([]);
    expect(homeCategoryTiles([trade("x", "X", 1)], -1)).toEqual([]);
  });

  it("orders ties by name so the row does not shuffle between launches", () => {
    const tiles = homeCategoryTiles([trade("b", "Beta", 1), trade("a", "Alpha", 1)], 8);
    expect(tiles.map((t) => t.label)).toEqual(["Alpha", "Beta"]);
  });
});
