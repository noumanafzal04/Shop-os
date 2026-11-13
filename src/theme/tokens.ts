import { Platform, type ViewStyle } from "react-native";

/**
 * Spacing, type and depth — the tokens that are NOT colours.
 *
 * The pigments moved to `palette.ts` and are re-exported below, so every
 * existing `from "./tokens"` still resolves. See that file for why: it has no
 * `react-native` import, which is the only reason the web panel can read the
 * brand ramp instead of keeping a third copy of it.
 */
export * from "./palette";

/**
 * One spacing ladder (2026-11-13): 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48.
 * Gutter 16, card padding 12, gap between cards 12, between sections 24.
 */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  ms: 12,
  md: 16,
  ml: 20,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * Corners by what they hold: a badge 6, a button / field / thumbnail 12, a
 * card or banner 16, a sheet 20, a chip / stepper / round button a pill.
 */
export const radius = {
  xs: 6,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  full: 9999,
} as const;

/**
 * One scale, few weights. Sizes are shared across themes — only colour flips,
 * because a heading that changes size with the theme is a heading nobody
 * designed.
 */
/**
 * ONE TYPE SCALE, SPLASH TO RECEIPT (2026-11-13).
 *
 * Every size carries its line height, so a line of text is the same height
 * wherever it sits and rows line up without anybody nudging a margin. One
 * family — the platform's own, which costs no download and no flash. Money
 * is set in tabular figures so a column of prices lines up.
 *
 *   display 28/34  the ETA, a confirmation
 *   title   22/28  screen titles
 *   h3      18/24  section headings
 *   name    16/22  a shop's or an item's name
 *   body    15/22  · subtitle 15/22
 *   label   14/18  buttons (M), chips, field labels
 *   small   13/18  descriptions
 *   caption 12/16  small labels
 *   tiny    11/14  the floor — a date, a count
 *   micro   11/14  bold: badges only
 *   price   15/20 · total 18/24 · button 16/20
 */
export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: "700" as const, letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700" as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: "700" as const, letterSpacing: -0.2 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: "600" as const },
  subtitle: { fontSize: 15, lineHeight: 22, fontWeight: "400" as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" as const },
  label: { fontSize: 14, lineHeight: 18, fontWeight: "600" as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const },
  tiny: { fontSize: 11, lineHeight: 14, fontWeight: "500" as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: "700" as const, letterSpacing: 0.2 },
  price: { fontSize: 15, lineHeight: 20, fontWeight: "600" as const, fontVariant: ["tabular-nums"] as ("tabular-nums")[] },
  total: { fontSize: 18, lineHeight: 24, fontWeight: "700" as const, fontVariant: ["tabular-nums"] as ("tabular-nums")[] },
  button: { fontSize: 16, lineHeight: 20, fontWeight: "600" as const },
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
