import { brand, cream, gray, ink } from "./tokens";

/**
 * The two themes.
 *
 * Semantic names only — a screen asks for `colors.surface`, never for
 * `gray[100]`. That is the whole point: the palette can move, and dark mode can
 * exist at all, without a component knowing.
 *
 * Dark is DESIGNED, not inverted. A flipped light theme gives you grey text on
 * grey cards and a brand colour that vibrates; these values were picked so the
 * same green reads correctly on both grounds and the flat, borders-not-shadows
 * style survives — which matters more in dark, where a border is the only thing
 * separating two surfaces.
 */

export interface ThemeColors {
  /** Brand scale — identical in both themes; green holds up on either ground. */
  brand: typeof brand;
  gray: typeof gray;

  /** App background, behind everything. */
  bg: string;
  /** Cards, sheets, rows. */
  surface: string;
  /** A second surface for nesting — search bars, inset blocks. */
  surfaceAlt: string;
  /** The hairline that does the work shadows would in a raised design. */
  border: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  /** For text sitting on a brand or ink fill. */
  textInverse: string;

  /** Near-black navy block — hero headers in light, elevated ground in dark. */
  ink: string;
  inkSoft: string;
  /** Warm promo surface. */
  cream: string;

  error: string;
  errorBg: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;

  white: string;
  black: string;
}

export const lightColors: ThemeColors = {
  brand,
  gray,

  bg: "#f6f6f3",
  surface: "#ffffff",
  surfaceAlt: "#f7f6f3",
  border: "#ecebe7",

  text: gray[900],
  textSecondary: gray[600],
  textMuted: gray[400],
  textInverse: "#ffffff",

  ink: ink.base,
  inkSoft: ink.soft,
  cream,

  error: "#f04438",
  errorBg: "#fef3f2",
  success: "#12b76a",
  successBg: "#ecfdf3",
  warning: "#f79009",
  warningBg: "#fffaeb",
  info: "#2e90fa",
  infoBg: "#eff8ff",

  white: "#ffffff",
  black: "#0c111d",
};

export const darkColors: ThemeColors = {
  brand,
  gray,

  // Lifted a touch off pure ink (#010f1c) so `ink` still reads as a distinct,
  // deeper block on top of the background rather than vanishing into it.
  bg: "#0b1117",
  surface: "#131c25",
  surfaceAlt: "#1a242f",
  border: "#24303c",

  text: "#e8edf2",
  textSecondary: "#9aa8b6",
  textMuted: "#6b7986",
  // Still white: the brand green is dark enough that white sits on it in both
  // themes, and flipping this to black would fail contrast on #3bb77e.
  textInverse: "#ffffff",

  ink: "#050d15",
  inkSoft: "#0c1a2a",
  // The warm cream is a light-theme device. On dark it becomes a muted warm
  // surface instead — same job (promo blocks), legible ground.
  cream: "#262019",

  // Hues held, tints rebuilt: a light pastel background would glow on dark.
  error: "#f97066",
  errorBg: "#2b1614",
  success: "#3bb77e",
  successBg: "#0f2a1e",
  warning: "#fdb022",
  warningBg: "#2b2010",
  info: "#53b1fd",
  infoBg: "#10202e",

  white: "#ffffff",
  black: "#0c111d",
};

export type ThemeName = "light" | "dark";

export const themes: Record<ThemeName, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};
