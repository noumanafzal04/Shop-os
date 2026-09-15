import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { shortcutArt, tradeArt } from "../src/modules/marketplace/tileArt";
import { SHORTCUTS } from "../src/modules/marketplace/tradeIcon";
import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * CATEGORY TILES.
 *
 * ── What is being checked, and what cannot be ────────────────────────
 *
 * Whether a tile LOOKS right is not testable and is not claimed here. What is
 * testable is every way one can be silently absent or silently blank, which is
 * the whole failure mode of a tile: a home screen with a hole in it looks like
 * a slow network, so nobody reports it.
 *
 * The trigger for the file: `Ellipse` was missing from the Jest SVG mock, so a
 * stack of coins rendered as `undefined` and React reported "Element type is
 * invalid" from a test about signed-out browsing. Nothing pointed at the
 * drawing or at the mock.
 *
 * ── The drawings became glyphs ───────────────────────────────────────
 *
 * These were twelve hand-authored flat illustrations. The report on them was
 * "fake sy icon lg rhy, emoji", and it was right — a multi-coloured cartoon
 * burger beside a multi-coloured cartoon car reads as a sticker sheet rather
 * than as a set of controls. They are Phosphor glyphs now, from the family the
 * tab bar and every menu already use, on a soft per-trade plate.
 *
 * So a tile is ONE `Path` rather than a composition, and the count below says
 * so. Everything else this file guards is unchanged: a trade with no entry, a
 * shortcut with no entry, a plate missing its dark half.
 */

const render = (el: React.JSX.Element) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(el);
  });
  return tree;
};

/** Every node type the drawings are built from. */
const SHAPES = ["Path", "Circle", "Rect", "Ellipse"];

const shapeCount = (tree: ReactTestRenderer.ReactTestRenderer) =>
  SHAPES.reduce((n, s) => n + tree.root.findAllByType(s as never).length, 0);

/**
 * The trades the server can send. Kept in step with `BusinessTypes::all()` on
 * the backend plus the legacy codes a shop created earlier still carries — the
 * same list `tradeIcon` covers, because a code that has a glyph and no drawing
 * is a blank tile.
 */
const TRADES = [
  "food", "mart", "pharmacy", "retail", "services", "automotive", "petroleum",
  "finance", "online",
  "restaurant", "bakery", "grocery", "wholesale", "clinic", "salon", "service",
  "workshop", "hardware", "books", "general",
];

describe("every trade has a drawing", () => {
  it("covers the ones the app already had a glyph for", () => {
    /**
     * THE DENOMINATOR, taken from the file that was already right.
     *
     * `tradeIcon.tsx` maps every trade code this app has ever seen. If a code
     * has an entry there and not here, that tile falls back to the shopfront —
     * which is a fine fallback and a poor answer for `pharmacy`.
     */
    const icons = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/marketplace/tradeIcon.tsx"), "utf8"),
    );
    const mapped = [...icons.matchAll(/^\s{2}(\w+): \w+Icon,$/gm)].map((m) => m[1]);

    expect(mapped.length).toBeGreaterThan(15);

    const art = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/marketplace/tileArt.tsx"), "utf8"),
    );
    const missing = mapped.filter((code) => !new RegExp(`^\\s{2}${code}:`, "m").test(art));

    expect(missing).toEqual([]);
  });

  it.each(TRADES)("draws something for %s", (trade) => {
    const { Icon, tint } = tradeArt(trade);
    const tree = render(<Icon size={30} color={tint[0]} />);

    // Not "renders without throwing" — an empty <Svg/> does that. A glyph is
    // one filled Path, so one shape is the floor and zero is the failure.
    expect(shapeCount(tree)).toBeGreaterThan(0);

    ReactTestRenderer.act(() => tree.unmount());
  });

  it("falls back rather than returning nothing", () => {
    // A trade this build has not heard of is still a shop, and a tile with no
    // picture is a blank square on the home screen.
    for (const unknown of ["florist", "", "  ", "PHARMACY_v2"]) {
      const { Icon, ground, tint } = tradeArt(unknown);
      expect(ground).toHaveLength(2);
      expect(tint).toHaveLength(2);

      const tree = render(<Icon size={30} color={tint[0]} />);
      expect(shapeCount(tree)).toBeGreaterThan(0);
      ReactTestRenderer.act(() => tree.unmount());
    }
  });

  it("matches case-insensitively, because a code is data", () => {
    // Business types arrive from the database. One row typed in capitals would
    // otherwise be the only shopfront in a row of glyphs.
    //
    // `toEqual`, not `toBe`: the entry is composed per call now rather than
    // held as a singleton, so identity is the wrong question — two tiles that
    // draw the same thing in the same colours ARE the same tile.
    expect(tradeArt("PHARMACY")).toEqual(tradeArt("pharmacy"));
  });
});

describe("every shortcut has a drawing", () => {
  it("covers all four, by the keys SHORTCUTS actually uses", () => {
    /**
     * Read from `SHORTCUTS` rather than typed out here. A fifth shortcut added
     * there with no hue returns null, and the caller draws it on a plain brand
     * plate — one odd tile in a row of tinted ones, which is worse than either
     * choice made consistently.
     */
    expect(SHORTCUTS.length).toBeGreaterThan(3);

    const missing = SHORTCUTS.filter((s) => shortcutArt(s.key) == null).map((s) => s.key);
    expect(missing).toEqual([]);
  });

  it.each(SHORTCUTS.map((s) => s.key))("draws something for %s", (key) => {
    const art = shortcutArt(key);
    expect(art).not.toBeNull();

    // Destructured rather than `art!.Icon` in the JSX — a non-null assertion
    // is not valid inside a JSX element name.
    const { Icon, tint } = art!;
    const tree = render(<Icon size={28} color={tint[0]} />);
    expect(shapeCount(tree)).toBeGreaterThan(0);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it("returns null for a key that is not one, rather than a wrong picture", () => {
    // The callers branch on null and keep the glyph. A silent default would put
    // a star on something that is not a rating.
    expect(shortcutArt("nonsense")).toBeNull();
  });
});

describe("the plate under the drawing", () => {
  it("has a colour for each theme", () => {
    // Same arrangement as `shopCover`. A pastel that ignored the theme would
    // be a row of bright patches at midnight.
    for (const trade of TRADES) {
      const [light, dark] = tradeArt(trade).ground;
      expect(light).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(light).not.toBe(dark);
    }
  });

  it("is read through the hook, not indexed by hand", () => {
    /**
     * `art.ground[0]` in a screen is a light-mode tile in dark mode, and it
     * would be correct-looking in every screenshot taken during the day.
     * `useTileGround` is the only thing that knows which index is which.
     */
    for (const screen of [
      "src/modules/marketplace/screens/CustomerHomeScreen.tsx",
      "src/modules/marketplace/screens/CategoriesScreen.tsx",
    ]) {
      const src = codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, screen), "utf8"));
      expect(src).toMatch(/useTileGround\(\)/);
      expect(src).not.toMatch(/\.ground\[/);
    }
  });
});

describe("no asset pipeline was added for this", () => {
  it("draws with primitives rather than shipping images", () => {
    /**
     * The request named a stock vector site. Those licences forbid
     * redistribution inside an application on their free tiers, and the files
     * are raster or editor formats — twelve categories at three densities is
     * thirty-six files in the APK and thirty-six decodes on the home screen,
     * for drawings that then cannot follow the theme.
     *
     * "App py load na pry" is the requirement, and this is what meets it.
     */
    const art = fs.readFileSync(
      path.join(PROJECT_ROOT, "src/modules/marketplace/tileArt.tsx"),
      "utf8",
    );

    /**
     * The REQUIREMENT, not the import.
     *
     * This asserted `from "react-native-svg"` in this file. That was true while
     * the tiles were drawn here shape by shape; they are Phosphor glyphs now,
     * and the SVG import moved one level down into `common/ui/icons`. Nothing
     * about "app py load na pry" changed — the file simply stopped being the
     * place the vectors are written.
     *
     * A test pinned to an import is pinned to where code lives rather than to
     * what it must not do, and it goes red on a refactor that broke nothing.
     */
    // No <Image>, no require of an asset, no remote URI — the three ways a
    // tile could start costing a download.
    expect(codeOnly(art)).not.toMatch(/<Image\b/);
    expect(codeOnly(art)).not.toMatch(/require\(".*\.(png|jpg|webp|svg)"\)/);
    expect(codeOnly(art)).not.toMatch(/https?:\/\//);

    // …and the glyphs it delegates to are vectors, drawn in the app.
    const icons = fs.readFileSync(
      path.join(PROJECT_ROOT, "src/common/ui/icons/index.tsx"),
      "utf8",
    );
    expect(icons).toMatch(/from "react-native-svg"/);
  });
});
