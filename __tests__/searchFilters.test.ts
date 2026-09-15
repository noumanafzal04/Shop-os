import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * THE ROW OF CONTROLS UNDER THE SEARCH TABS.
 *
 * ── What was reported ────────────────────────────────────────────────
 *
 * "Search page filters ka UI disturb hai."
 *
 * Three things, and each one is invisible in a screenshot of a wide phone:
 *
 *   · `flexDirection: "row"` with no wrap and no scroll. On the All tab the
 *     row holds two chips AND the aisle pill — roughly 330pt of content — so
 *     on anything under about 360pt it was simply CLIPPED, with no scrollbar
 *     to say anything had been cut;
 *   · padding on top and none underneath, so it sat against the first result;
 *   · the chips were `paddingVertical: 6` and the pill 7, so two controls on
 *     one line were a pixel different in height.
 *
 * ── Why source text ──────────────────────────────────────────────────
 *
 * jsdom has no layout engine — it cannot measure 330pt against 360. What it
 * CAN hold is the rule that made the overflow possible in the first place: a
 * row of controls that can neither wrap nor scroll.
 */

const src = codeOnly(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "src/modules/marketplace/screens/SearchScreen.tsx"),
    "utf8",
  ),
);

/** The `filters` style block, whole. */
const filters = (): string => {
  const at = src.indexOf("  filters: {");
  if (at === -1) throw new Error("the filters row moved — find it before trusting this file");

  return src.slice(at, src.indexOf("},", at) + 2);
};

describe("the search filter row", () => {
  it("has the file to read", () => {
    expect(src).toBeDefined();
    expect(filters()).toContain("flexDirection");
  });

  /**
   * The row holds two chips and a pill on the All tab. Without one of these
   * the third control is off the edge of a small phone and nothing says so.
   */
  it("can give way rather than clipping", () => {
    const row = filters();
    const canYield = row.includes('flexWrap: "wrap"') || row.includes("horizontal");

    expect(canYield).toBe(true);
  });

  /** Padding on both sides, or the controls touch the first result. */
  it("does not sit against the results", () => {
    expect(filters()).toContain("paddingBottom");
  });

  /**
   * Two controls on one line at two heights is the kind of thing nobody can
   * name and everybody can see.
   */
  it("draws the chip and the pill at the same height", () => {
    const chip = src.slice(src.indexOf("  filter: {"), src.indexOf("  filterOn:"));
    const pill = src.slice(src.indexOf("  aisle: {"), src.indexOf("  aisleText:"));

    const pad = (block: string) => block.match(/paddingVertical:\s*(\d+)/)?.[1];

    expect(pad(chip)).toBeDefined();
    expect(pad(chip)).toBe(pad(pill));
  });

  /**
   * The pill asks the SERVER a different question from the chips, which narrow
   * what is already on screen. It is not a third chip, so it does not queue
   * with them.
   */
  it("puts the aisle door at the end of its line", () => {
    expect(src.slice(src.indexOf("  aisle: {"))).toMatch(/marginLeft:\s*"auto"/);
  });

  /** A wrapped label inside a fixed-height pill is the shape that reads as
   *  broken. */
  it("keeps every control's label on one line", () => {
    expect(src).toMatch(/numberOfLines=\{1\}[\s\S]{0,120}?styles\.filterText/);
    expect(src).toMatch(/numberOfLines=\{1\} style=\{styles\.aisleText\}/);
  });
});
