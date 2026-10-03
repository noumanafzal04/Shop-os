/**
 * THE PIGMENTS — and nothing else, so a browser can read them too.
 *
 * ── Why this is a file of its own ────────────────────────────────────
 *
 * `tokens.ts` imports `react-native` (for `Platform` and `ViewStyle`, both
 * used only by `shadow`). That single import is enough to make the whole file
 * unreadable to the web panel's bundler — so the panel kept its own copy of
 * the brand ramp, in CSS, and the two drifted into THREE different "primary"
 * blues at once: #0755e9 in the stylesheet, #465fff in the tenant theme, and
 * the logo's own.
 *
 * Colours are plain data. Splitting them out costs one file and means every
 * client — two phones and a browser — reads the same hexes.
 *
 * `tokens.ts` re-exports all of this, so nothing that imported from there has
 * to move.
 */
/**
 * The raw scales. Nothing here knows about light or dark — these are the
 * pigments, and `themes.ts` decides where each one gets used.
 *
 * ── The palette, and why it is these colours ───────────────────────────
 *
 * Approved from a reference the user chose: a hot red-orange over near-white,
 * with a warm amber for anything that shouts about money.
 *
 *   #E94E00  primary   the brand, and the only thing allowed to be loud
 *   #FB7331  accent    a lighter step of the same hue — dark mode's primary
 *   #EBC249  warm      offers, ratings, the selected tab — never a button
 *   #80B931  green     confirmation: an item added, a fee waived
 *   #221711  ink       the bar, and any block the page sits under
 *   #FFFFFF  surface
 *
 * ── One note on contrast, so it is a decision and not an oversight ────
 *
 * White on #E94E00 is about 3.1:1. That clears AA for large or bold display
 * text and not for body text, so `onPrimary` is for BUTTON LABELS and icons on
 * a brand fill — never for a paragraph. Anything smaller reads `text` on a
 * plain ground. The previous, darker red cleared 4.2:1; this is the cost of
 * the warmer hue and it is worth stating rather than discovering.
 *
 * The names here did NOT change when the colours did. `brand[500]` is read in
 * roughly five hundred places, and a rename would have been five hundred edits
 * to achieve exactly what changing one hex achieves — while a half-finished
 * rename leaves two palettes on screen at once.
 */

/**
 * Ten steps, light to dark — or, in a dark theme, faint to loud. A scale is a
 * shape, not a set of hexes: `as const` below gives the literal palette its
 * exact type, which is useful at a call site and useless to a THEME, because a
 * second scale could then never satisfy it. See `themes.ts`.
 */
export type ColorScale = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;

export const brand = {
  50: "#fef2f2",
  100: "#fee2e2",
  200: "#fecaca",
  300: "#fca5a5",
  400: "#f87171", // the accent — and the brand's face in dark mode
  500: "#ef4444", // the primary
  600: "#dc2626",
  700: "#b91c1c",
  800: "#991b1b",
  900: "#7f1d1d",
} as const;

/**
 * Amber, for what a shop is offering.
 *
 * Deliberately NOT a second brand colour: it marks a discount, a rating star, a
 * countdown — things the eye should find without being asked to act. Nothing
 * tappable is this colour, or the page ends up with two primaries and neither
 * reads as the important one.
 */
export const warm = {
  100: "#fdf6e2",
  300: "#f5dc94",
  500: "#ebc249",
  // 700 exists because 500 is a FILL and this is the TEXT.
  //
  // Yellow on white is around 1.6:1 — not "a bit low", unreadable. The warning
  // copy used to be written in warm[500] and was already poor at #FC8F1A; at
  // #EBC249 it would have disappeared. A scale that is only ever a fill hides
  // that; naming the darker step forces the choice at each call site.
  700: "#a8871f",
} as const;

/**
 * Green, for confirmation.
 *
 * Not a second brand colour and never a button: it says a thing HAPPENED — an
 * item went into the basket, a delivery fee was waived. Same split as `warm`:
 * 500 is the fill, 600 is the text, because #80B931 on white is 2.4:1.
 */
export const green = {
  100: "#f1f8e4",
  300: "#b4d97a",
  500: "#80b931",
  600: "#5c8a20",
  700: "#4d7318",
} as const;

/**
 * Warm greys, and warm on purpose.
 *
 * The scale this replaced was a cool blue-grey, which is the standard choice
 * and the wrong one beside a red-orange: a blue-tinted card under a #E94E00
 * button makes the button look faintly purple, and the eye reads the whole
 * screen as slightly dirty. These carry a trace of the brand's own hue, so
 * grey and brand belong to each other.
 */
export const gray = {
  50: "#faf8f7",
  100: "#f4f1ef",
  200: "#e9e4e0",
  300: "#d8d0cb",
  400: "#aaa09a",
  500: "#7e746e",
  600: "#5d544f",
  700: "#453d39",
  800: "#2c2522",
  900: "#1a1512",
} as const;

/** Near-black, warm. Hero blocks in light; the deepest ground in dark. */
export const ink = {
  base: "#221711",
  soft: "#35251c",
  muted: "#8a807a",
} as const;

/** Warm cream — offer and promo cards. */
export const cream = "#fdf1e7";

/**
 * MEADOW — the shopping side's own ten, given as a reference strip rather
 * than invented here.
 *
 * It is one continuous ramp from a lime #D9ED92 to a deep ocean #184E77:
 * hue travels 73 deg to 206 deg and lightness 75% to 28%, evenly, which is
 * why it works as a GRADIENT as well as a set of swatches. Most palettes do
 * not have that property and it is the thing worth protecting here — reorder
 * these and the gradient below stops being smooth.
 *
 * The ramp is split by JOB, not by taste:
 *
 *   #D9ED92 .. #76C893   the fresh half — offers, confirmations, tinted
 *                        grounds. Too light to carry white text; every one
 *                        of them wants dark ink on top.
 *   #52B69A .. #34A0A4   the turn. Fills and marks, never body text.
 *   #168AAD .. #184E77   the deep half — the brand's own voice. #1A759F is
 *                        5.14:1 against white, which is the whole reason the
 *                        primary sits there and not three steps up.
 *
 * Kept as raw pigments because two different things read them: `themes.ts`,
 * which assigns them semantic names per theme, and the gradient below, which
 * needs them in ORDER and would be meaningless as semantic tokens.
 */
export const meadow = {
  lime: "#d9ed92",
  sprout: "#b5e48c",
  leaf: "#99d98c",
  fern: "#76c893",
  sea: "#52b69a",
  lagoon: "#34a0a4",
  teal: "#168aad",
  ocean: "#1a759f",
  deep: "#1e6091",
  abyss: "#184e77",
} as const;

/**
 * THE SIGNATURE, and the one place the whole ramp is used at once.
 *
 * Three stops rather than ten: a gradient reading every swatch is a rainbow,
 * and the eye cannot tell nine transitions apart on a 200pt header anyway.
 * These three are the ramp's ends and its midpoint, so the result is the same
 * curve at lower resolution.
 *
 * Written light-first (`from` is the lime) because that is the order the
 * reference strip reads in and the order a header draws in — top-left to
 * bottom-right. A component that wants it the other way reverses it at the
 * call site, where the direction is visible.
 */
export const gradients = {
  /**
   * The deep half, DARKEST FIRST — the hero ground, and the one a theme
   * publishes as `colors.gradient`.
   *
   * The order is the contract: a header's first stop is where the status bar
   * and the first line of type sit, so it has to be the end white can be
   * read on. Reversing this at a call site is how a bell icon ends up at
   * 1.2:1 on a lime corner.
   */
  ocean: [meadow.abyss, meadow.ocean, meadow.lagoon],
  /**
   * The whole strip, for DECORATION — a block with no words on it, or one
   * whose words are dark. It is the palette's own argument, and it is not a
   * text ground: it spans 1.27:1 to 8.77:1 against white, so nothing light
   * is legible across all of it.
   */
  meadow: [meadow.lime, meadow.sea, meadow.abyss],
  /** The fresh half only — for an offer card that must stay light. */
  fresh: [meadow.lime, meadow.leaf, meadow.sea],
} as const;

/**
 * THE DEEP HALF, as a scale.
 *
 * 400 through 700 are the strip's own pigments, untouched. 50–300 and 800–900
 * are derived, because the strip stops where it stops and a scale needs tints
 * pale enough to sit a chip on and shades dark enough to press a button into.
 * They are the same hue (≈200 deg) at the lightness the ladder asks for, so
 * the derived steps cannot drift into a second colour.
 */
export const oceanBrand: ColorScale = {
  50: "#eaf3f8",
  100: "#cfe6f0",
  200: "#a6d2e3",
  300: "#6bb6cf",
  400: "#168aad",
  // 500: the brand at full strength — the index five hundred call sites ask
  // for. 5.14:1 against white, which is why it is here and not at 400.
  500: "#1a759f",
  600: "#1e6091",
  700: "#184e77",
  800: "#143f61",
  900: "#0f2f49",
};

/**
 * The two steps a 10-point scale does not have, for the web panel.
 *
 * Tailwind's generated ramp runs 25 through 950 — twelve steps where this
 * scale has ten. They live HERE rather than in the stylesheet so the panel's
 * brand ramp is derived from the same ladder the phones use, and
 * `brandRamp.test.ts` holds the CSS to it.
 *
 * 25 is a wash a whole page can sit on; 950 is deeper than anything a phone
 * needed, and the panel uses it for the till's dark chrome.
 */
export const oceanBrandWeb = {
  25: "#f5f9fc",
  ...oceanBrand,
  950: "#0a2033",
} as const;
