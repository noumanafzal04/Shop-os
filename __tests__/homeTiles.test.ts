import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * SEVEN TILES AND A WAY TO THE REST — the same eight, in every city.
 *
 * ── What was reported ────────────────────────────────────────────────
 *
 * "Currently kuch ni hoti to kam zeyda ho rhi categories."
 *
 * The grid was four shortcuts plus up to three trades plus "View all", and the
 * three came from the server's `business_types` — which listed only the trades
 * that HAVE shops in this city. So it was eight tiles in Lahore, five in a town
 * with two shops, and a ragged half-row in between.
 *
 * The size of a grid is a layout decision. It was being made by the data.
 *
 * ── The two halves of the fix ────────────────────────────────────────
 *
 * The server sends every browsable trade now, shops-first, carrying an honest
 * `shops_count` (asserted in `LahoreShopsSeederTest`). And the shortcuts moved
 * OUT of the grid into their own row rather than being dropped — they narrow
 * the aisle, the tiles open a trade, and drawing two different destinations as
 * one row of identical squares is most of why that grid never read as anything.
 *
 * Reads source text — a lint rule wearing a test's clothes, same instrument as
 * `posChrome.test.ts`. jsdom has no layout engine, so "two rows of four" is not
 * a thing any test here can see; what it CAN hold is the arithmetic.
 */

const src = codeOnly(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "src/modules/marketplace/screens/CustomerHomeScreen.tsx"),
    "utf8",
  ),
);

describe("the category grid is always eight", () => {
  it("shows seven trades", () => {
    expect(src).toMatch(/const HOME_TRADES = 7;/);
  });

  /**
   * Seven plus "View all" is eight, which is two whole rows at a quarter-width
   * per tile. Any other number leaves an orphan in the corner, which is the
   * complaint this whole file exists for.
   */
  it("leaves room for exactly one more tile", () => {
    const n = Number(src.match(/const HOME_TRADES = (\d+);/)?.[1]);
    expect((n + 1) % 4).toBe(0);
  });

  /** The tile that opens the rest, drawn whatever the server said. */
  it("always draws the way to the rest", () => {
    const at = src.indexOf('accessibilityLabel="View all categories"');
    expect(at).toBeGreaterThan(-1);

    // The line before must not be a condition — this tile rendered behind
    // `business_types.length > 4` once, the server sent exactly four, and the
    // only way to the categories page did not exist.
    const before = src.slice(0, at).trimEnd();
    expect(before.endsWith("&&")).toBe(false);
    expect(before.endsWith("?")).toBe(false);
    expect(before.endsWith("||")).toBe(false);
  });

  /**
   * The shortcuts were MOVED, not deleted. Four destinations quietly vanishing
   * is a worse outcome than a crowded grid.
   */
  it("keeps the four aisle shortcuts, outside the grid", () => {
    expect(src).toContain("SHORTCUTS.map");
    expect(src).toMatch(/styles\.chipRow/);
    // …and they no longer sit in the tile container, or the grid is twelve.
    expect(src).not.toMatch(/SHORTCUTS\.map[\s\S]{0,400}?styles\.tile[,\s]/);
  });

  /**
   * A trade with no shops here is drawn quieter and stays reachable — the list
   * it opens has a real empty state, and a page that says "none near you yet"
   * answers the question the tap was asking. A dead tile answers nothing.
   */
  it("shows an empty trade at half strength rather than hiding it", () => {
    expect(src).toMatch(/const empty = t\.shops_count === 0;/);
    expect(src).toMatch(/tileEmpty: \{ opacity: [\d.]+ \}/);
    // Still a button: no `disabled`, and the label says what it is.
    const tile = src.slice(src.indexOf("const empty = t.shops_count"), src.indexOf("styles.tileIcon"));
    expect(tile).not.toMatch(/disabled=/);
    expect(tile).toMatch(/none nearby yet/);
  });
});
