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
