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

describe("the trades: one scrolling row, foodpanda's verticals", () => {
  /*
   * A ROW THAT SCROLLS, so no count can leave an orphan in a corner — the
   * complaint this file was first written for. What still has a number is
   * the cap: a row of thirty is not a row anybody reads.
   */
  it("caps the row, and lays it out sideways", () => {
    expect(src).toMatch(/const HOME_TRADES = 8;/);
    expect(src).toMatch(/<ScrollView horizontal showsHorizontalScrollIndicator=\{false\} contentContainerStyle=\{styles\.tiles\}>/);
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
   * A TRADE WITH NO SHOPS HERE IS NOT DRAWN AT ALL.
   *
   * It used to be a faded tile reading "None nearby" — first tappable (the
   * report: "koi shop ni arhi"), then a dead label. On a fresh city that was
   * five dead tiles out of seven: an app that looks broken on the screen
   * everybody opens first. The whole breadth is one tap away on the
   * categories page, where an empty trade is an answer rather than a tile.
   */
  it("draws only trades that have a shop here", () => {
    expect(src).toMatch(/\.filter\(\(t\) => t\.shops_count > 0\)\.slice\(0, HOME_TRADES\)/);
    expect(src).not.toMatch(/None nearby"?\s*<\/Text>/);
  });
});

describe("every rail has a way onward", () => {
  /**
   * HALF A RULE, which is the shape this repo keeps finding.
   *
   * Two of the four headings carried "See all" and two did not — so "Deals for
   * you" and "Top rated" were rails you scrolled to the end of and then
   * nothing. A convention applied to some of the places it belongs makes the
   * missed ones read as broken rather than as deliberately different.
   */
  it("gives all four sections a See all", () => {
    const headers = [...src.matchAll(/<SectionHeader\s+title="([^"]+)"([^/]*)\/>/g)];

    expect(headers.length).toBeGreaterThanOrEqual(3);

    const deadEnds = headers.filter(([, , rest]) => !rest.includes("onSeeAll")).map(([, title]) => title);
    expect(deadEnds).toEqual([]);
  });

  /**
   * …and it goes where the chip four inches above it goes.
   *
   * Written from `SHORTCUTS` rather than typed twice: a "See all" under Deals
   * that filtered differently from the Offers chip would be two controls
   * promising one thing and answering with two lists.
   */
  it("takes the destination from the shortcut that already narrows it", () => {
    expect(src).toMatch(/SHORTCUTS\.find\(\(x\) => x\.key === key\)/);
    expect(src).toMatch(/seeAll\("offers"/);
    expect(src).toMatch(/seeAll\("top"/);
  });
});
