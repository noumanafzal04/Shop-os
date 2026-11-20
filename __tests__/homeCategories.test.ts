import { homeCategoryTiles, TILE_GAP, TILES_ACROSS, tileSize } from "../src/modules/marketplace/homeCategories";

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

/**
 * "4 KI BAJAYE 5 CATEGORIES SHOW KRWAO, THORA SIZE KAM" — the tiles were a
 * fixed 84, so a phone showed four and a bit. Five whole tiles must fit the
 * screen with the row's padding and gaps; the size stays in a sane band.
 */
describe("five category tiles across", () => {
  const fits = (w: number) => {
    const { tile } = tileSize(w);
    return 16 * 2 + tile * TILES_ACROSS + TILE_GAP * (TILES_ACROSS - 1) <= w;
  };

  it.each([360, 375, 390, 412, 430])("fits five whole tiles on a %ipt phone", (w) => {
    expect(fits(w)).toBe(true);
  });

  it("is smaller than the old 84-point tile on every phone", () => {
    for (const w of [360, 390, 430]) expect(tileSize(w).tile).toBeLessThan(84);
  });

  it("keeps a floor on a tiny screen and a ceiling on a tablet", () => {
    expect(tileSize(240).tile).toBe(56);
    expect(tileSize(1024).tile).toBe(76);
    expect(tileSize(Number.NaN).tile).toBe(56);
  });

  it("keeps the corner radius under half the tile (Fabric draws half as a square)", () => {
    for (const w of [240, 360, 412, 1024]) {
      const s = tileSize(w);
      expect(s.radius * 2).toBeLessThan(s.tile);
      expect(s.pic).toBeLessThan(s.tile);
    }
  });

  it("both rails size their tiles from the screen, none is a fixed 84", () => {
    const { PROJECT_ROOT, codeOnly, fs, path } = jest.requireActual("./support/node");
    for (const rel of ["src/modules/marketplace/screens/CustomerHomeScreen.tsx", "src/modules/marketplace/screens/MarketScreen.tsx"]) {
      const src = codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));
      expect(src).toMatch(/tileSize\(width\)/);
      expect(src).not.toMatch(/width: 84/);
    }
  });
});
