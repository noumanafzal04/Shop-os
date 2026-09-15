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
  /**
   * An empty trade is INFORMATION, not a control.
   *
   * It was a dimmed `Touchable` that opened a list with a perfectly honest
   * empty state — and the report on that was four words: "koi shop ni arhi".
   * Nobody reads an empty page as an answer; they read it as an app that did
   * not work, and three of the seven tiles were doing it.
   *
   * A muted button and a muted label look almost the same and behave entirely
   * differently, so this checks the BEHAVIOUR: the empty branch returns a
   * plain `View`, with no press handler and no button role.
   */
  it("does not offer a trade that has nothing behind it", () => {
    expect(src).toMatch(/const empty = t\.shops_count === 0;/);

    const branch = src.slice(src.indexOf("if (empty) {"), src.indexOf("return (\n              <Touchable"));
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).not.toMatch(/onPress=/);
    expect(branch).not.toMatch(/accessibilityRole="button"/);
    expect(branch).not.toMatch(/<Touchable/);
    // …and it says why, or a faded tile is one somebody presses anyway.
    expect(branch).toMatch(/None nearby/);
  });

  it("still draws it, rather than letting the data resize the grid", () => {
    expect(src).toMatch(/tileEmpty: \{ opacity: [\d.]+ \}/);
    expect(src).toMatch(/const HOME_TRADES = 7;/);
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
