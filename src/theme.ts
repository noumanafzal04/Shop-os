import { Platform, type ViewStyle } from "react-native";

/**
 * Design tokens. `brand` is the placeholder scale — swap for the final brand
 * hex in one place and the whole app re-themes (mirrors the web
 * --color-brand-* scale).
 */
export const colors = {
  // Brand palette (user-approved): #3BB77E green · #010F1C ink · #999999 gray · #EDE9E0 cream
  brand: {
    50: "#eaf7f0",
    100: "#d3efe1",
    200: "#a8dfc4",
    300: "#7bcfa6",
    400: "#54c390",
    500: "#3bb77e",
    600: "#2e9c68",
    700: "#257f55",
    800: "#1e6544",
    900: "#174e35",
  },
  // Near-black navy — headers and hero blocks (light text on top).
  ink: "#010f1c",
  inkSoft: "#0c1a2a",
  inkMuted: "#999999",
  // Warm cream — offer/promo cards.
  cream: "#ede9e0",
  gray: {
    50: "#f9fafb",
    100: "#f2f4f7",
    200: "#e4e7ec",
    300: "#d0d5dd",
    400: "#98a2b3",
    500: "#667085",
    600: "#475467",
    700: "#344054",
    800: "#1d2939",
    900: "#101828",
  },
  // Semantic surfaces — warm, flat, bordered (no shadows).
  bg: "#f6f6f3",        // app background
  surface: "#ffffff",   // cards / sheets
  surfaceAlt: "#f7f6f3",
  border: "#ecebe7",
  white: "#ffffff",
  black: "#0c111d",
  // Status
  error: "#f04438",
  errorBg: "#fef3f2",
  success: "#12b76a",
  successBg: "#ecfdf3",
  warning: "#f79009",
  warningBg: "#fffaeb",
  info: "#2e90fa",
  infoBg: "#eff8ff",
} as const;

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
 * FLAT design system — cards separate with borders + background contrast,
 * not shadows. The tokens stay so call-sites don't change; only `lg` keeps
 * a whisper of depth for floating elements (the cart FAB, sheets).
 */
export const shadow: Record<"sm" | "md" | "lg", ViewStyle> = {
  sm: {},
  md: {},
  lg: Platform.select({
    ios: { shadowColor: "#101a26", shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 4 },
    default: {},
  })!,
};
