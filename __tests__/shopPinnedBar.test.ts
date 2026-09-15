import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * THE BAR THAT STICKS TO THE TOP OF A SHOP'S MENU.
 *
 * ── Two faults, reported as one ──────────────────────────────────────
 *
 * "Categories jo sticky hain mobile header ke sath issue create kar rahi,
 * properly show ni ho rahi." Then: "top notch ka issue."
 *
 * 1. IT WENT UNDER THE NOTCH. `SafeScreen` puts `paddingTop: insets.top` on
 *    its root, and this bar is an absolutely positioned child of it — Yoga
 *    measures an absolute child's `top` from the parent's BORDER box, not its
 *    padding box. So `top: 0` is the very top of the screen whatever padding
 *    the parent carries, and this was the only element on the page affected,
 *    which is why it looked like the bar alone was broken.
 *
 * 2. IT TOOK THE HEADER'S PLACE WITHOUT BEING ONE. The only way back is the
 *    round button inside the hero, and the hero is the list's header — so it
 *    scrolls away at exactly the moment this bar appears. The top of a
 *    scrolled shop page was a strip of chips with no name and no exit.
 *
 * ── Why source text ──────────────────────────────────────────────────
 *
 * jsdom has no layout engine and cannot see a notch. What it can hold is that
 * the bar accounts for the inset AT ALL, and that the way out exists.
 */

/**
 * The pinned block, from its own guard to the list element after it.
 *
 * Anchored on `"\n      <FlatList"` with the indentation, not on `<FlatList`
 * — which first appears two hundred lines earlier inside
 * `useRef<FlatList<MenuRow>>`, so the slice came out empty and both
 * assertions below "passed" against nothing. The third anchor today to match
 * something that merely looked like its subject.
 */
const pinnedBlock = (): string => {
  const from = src.indexOf("{pinned && (");
  const to = src.indexOf("\n      <FlatList");
  if (from === -1 || to === -1 || to <= from) {
    throw new Error("the pinned block moved — find it before trusting this file");
  }

  return src.slice(from, to);
};

const src = codeOnly(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "src/modules/marketplace/screens/MarketShopScreen.tsx"),
    "utf8",
  ),
);

describe("the pinned category bar", () => {
  it("has the file to read", () => {
    expect(src).toContain("catsPinned");
  });

  /**
   * The bar is `position: absolute, top: 0`, so nothing above it in the tree
   * holds it clear of the status bar. It has to do that itself.
   */
  it("holds itself clear of the notch", () => {
    expect(src).toMatch(/styles\.catsPinned,\s*\{ paddingTop: insets\.top \}/);
  });

  /**
   * As PADDING, not as an offset. `top: insets.top` would leave a transparent
   * strip above the bar with the list scrolling through it.
   */
  it("still starts at the very top, so the fill runs behind the status bar", () => {
    const style = src.slice(src.indexOf("  catsPinned: {"), src.indexOf("},", src.indexOf("  catsPinned: {")));

    expect(style).toMatch(/top:\s*0/);
  });

  /** The way back, which scrolled away with the hero. */
  it("carries a back button and the shop's name while it is up", () => {
    const block = pinnedBlock();

    expect(block).toMatch(/navigation\.goBack\(\)/);
    expect(block).toMatch(/business_name/);
  });

  /**
   * One line. The bar's height is what the chips' position depends on, and a
   * two-line shop name moves them away from where their in-flow copy sits —
   * which is the one thing that gives a two-element sticky away.
   */
  it("does not let a long shop name change the bar's height", () => {
    const block = pinnedBlock();

    expect(block).toMatch(/numberOfLines=\{1\}/);
  });

  /**
   * And a jump has to clear the WHOLE bar. This cleared `CHIP_BAR` alone,
   * which was right while the pinned element was the chips — with a header
   * above them, the heading landed under the shop's own name.
   */
  it("scrolls a category clear of the header as well as the chips", () => {
    expect(src).toMatch(/viewOffset:\s*insets\.top \+ PINNED_HEAD \+ CHIP_BAR/);
  });
});
