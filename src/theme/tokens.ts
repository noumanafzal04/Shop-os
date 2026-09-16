import { Platform, type ViewStyle } from "react-native";

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
  50: "#fff4ed",
  100: "#ffe4d3",
  200: "#ffc3a2",
  300: "#ff9a68",
  400: "#fb7331", // the accent — and the brand's face in dark mode
  500: "#e94e00", // the primary
  600: "#c04000",
  700: "#983405",
  800: "#762a09",
  900: "#5c2108",
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

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
} as const;

/**
 * One scale, few weights. Sizes are shared across themes — only colour flips,
 * because a heading that changes size with the theme is a heading nobody
 * designed.
 */
export const typography = {
  display: { fontSize: 30, fontWeight: "700" as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.3 },
  h3: { fontSize: 17, fontWeight: "600" as const },
  subtitle: { fontSize: 15, fontWeight: "400" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  label: { fontSize: 14, fontWeight: "600" as const },
  small: { fontSize: 13, fontWeight: "400" as const },
  tiny: { fontSize: 11, fontWeight: "500" as const },
} as const;

/**
 * FLAT design system — cards separate with borders and background contrast,
 * never shadows. The tokens stay so call sites don't change; only `lg` keeps a
 * whisper of depth for genuinely floating things (the cart FAB, bottom sheets).
 */
export const shadow: Record<"sm" | "md" | "lg", ViewStyle> = {
  sm: {},
  md: {},
  lg: Platform.select({
    ios: { shadowColor: "#2c1a12", shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 4 },
    default: {},
  })!,
};
