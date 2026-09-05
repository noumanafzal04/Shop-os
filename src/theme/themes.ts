import { brand, cream, gray, green, ink, warm, type ColorScale } from "./tokens";

/**
 * The two themes.
 *
 * Semantic names only — a screen asks for `colors.surface`, never for
 * `gray[100]`. That is the whole point: the palette can move, and dark mode can
 * exist at all, without a component knowing.
 *
 * Dark is DESIGNED, not inverted. A flipped light theme gives you grey text on
 * grey cards and a brand colour that vibrates; these values were picked so the
 * flat, borders-not-shadows style survives — which matters more in dark, where
 * a border is the only thing separating two surfaces.
 */

export interface ThemeColors {
  /**
   * The brand scale AS THIS THEME USES IT.
   *
   * Not the same pigments in both: see `darkBrand` below for why a step means
   * a job rather than a colour.
   */
  brand: ColorScale;
  gray: ColorScale;

  /**
   * The brand colour, by the job it does.
   *
   * New code reads these. `brand[500]` still resolves correctly and is what the
   * existing screens use, but an index is a fact about a scale and `primary` is
   * a fact about the design — and only one of those survives a repalette.
   */
  primary: string;
  primaryPressed: string;
  /** A tinted ground for a selected chip or an inline notice. */
  primarySoft: string;
  /** Text and icons sitting ON `primary`. */
  onPrimary: string;

  /** Offers, ratings, countdowns. Never a button — see `tokens.ts`. */
  warm: string;
  warmSoft: string;
  onWarm: string;

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

  /** Near-black block — hero headers in light, elevated ground in dark. */
  ink: string;
  inkSoft: string;
  /**
   * Text and icons resting ON an ink block, at low emphasis.
   *
   * `textMuted` is muted against the PAGE and disappears against ink; this is
   * the same job on the other ground. A bar drawn in ink needs both — the
   * selected item in `onPrimary`, everything else in this.
   */
  inkMuted: string;
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

/**
 * The brand scale, shifted for a dark ground.
 *
 * #E94E00 is a heavily saturated orange-red. On near-white it is the loudest
 * thing on the page, which is its job. On near-black it stops being loud and
 * starts being muddy — a dark warm red on a dark ground reads as a dead area
 * rather than a control.
 *
 * So in dark an index names the JOB rather than a pigment: `500` — the step
 * five hundred call sites already ask for — is still "the brand at full
 * strength", and on this ground that is #F35D3B. Below it the steps get darker
 * (a faint brand ground on a dark page is dark); above it they get brighter,
 * because "louder than full strength" has nowhere else to go. That is what lets
 * a screen written once look deliberate in both themes.
 */
/**
 * The greys, same idea.
 *
 * Shared, these are a trap: `gray[900]` is the darkest ink in light and, on a
 * near-black page, near-black text on near-black. A component reaching past the
 * semantic tokens for a grey is doing something the tokens do not cover, and it
 * should still be legible when it does.
 */
const darkGray: ColorScale = {
  50: "#141010",
  100: "#1d1816",
  200: "#2b2320",
  300: "#3d332f",
  400: "#6a5f59",
  500: "#8b807a",
  600: "#a99e97",
  700: "#c7bdb7",
  800: "#e0d8d3",
  900: "#f4efec",
};

const darkBrand: ColorScale = {
  // 50–300: the brand barely present — a tinted ground for a selected chip or
  // an inline notice. On a dark page "barely present" is DARK, which is why
  // these are not the light theme's pale tints with the numbers kept.
  50: "#2b0f04",
  100: "#3f1607",
  200: "#5a210b",
  300: "#7f3213",
  400: "#c25423",
  // 500: the brand at full strength, the index the screens ask for.
  500: "#fb7331",
  // 600–900: LOUDER than full strength. In light that means darker; on a dark
  // ground the only direction left is brighter, so a pressed button lifts
  // instead of sinking. Same semantics, opposite pigments — which is the whole
  // reason this scale is written out rather than reused.
  600: "#ff8a4f",
  700: "#ffa470",
  800: "#ffc4a0",
  900: "#ffe5d5",
};

export const lightColors: ThemeColors = {
  brand,
  gray,

  primary: brand[500],
  primaryPressed: brand[600],
  primarySoft: brand[50],
  onPrimary: "#ffffff",

  warm: warm[500],
  warmSoft: warm[100],
  onWarm: "#3a2a00",

  bg: "#f7f5f3",
  surface: "#ffffff",
  surfaceAlt: "#f6f2ef",
  border: "#ece6e2",

  text: gray[900],
  textSecondary: gray[600],
  textMuted: gray[400],
  textInverse: "#ffffff",

  ink: ink.base,
  inkSoft: "#35251c",
  inkMuted: "#9a8b84",
  cream,

  // A truer red than the brand's orange-red, so a refusal never reads as a
  // button. At hue 4 against the brand's 20 they are told apart at a glance.
  error: "#d92d20",
  errorBg: "#fdf3f2",
  success: green[600],
  successBg: green[100],
  // The DARKER step: warning copy is text, and warm[500] is a fill.
  warning: warm[700],
  warningBg: warm[100],
  info: "#2e90fa",
  infoBg: "#eff8ff",

  white: "#ffffff",
  black: "#0c0705",
};

export const darkColors: ThemeColors = {
  brand: darkBrand,
  gray: darkGray,

  primary: darkBrand[500],
  primaryPressed: darkBrand[600],
  // A tint of the brand deep enough to sit UNDER text on a dark ground. The
  // light theme's #fff2ee here would be a white block with a red name.
  primarySoft: darkBrand[100],
  onPrimary: "#ffffff",

  warm: "#f2ce62",
  warmSoft: "#332a10",
  onWarm: "#221711",

  // Warm near-blacks, so the ground belongs to the same family as the brand.
  // A neutral charcoal under a red-orange reads as two unrelated designs.
  bg: "#0d0907",
  surface: "#17100d",
  surfaceAlt: "#201713",
  border: "#2e2320",

  text: darkGray[900],
  textSecondary: darkGray[600],
  textMuted: darkGray[400],
  // Still white: #f35d3b is light enough to carry white at button sizes, and
  // flipping this to black would fail on the darker pressed state.
  textInverse: "#ffffff",

  ink: "#080504",
  inkSoft: "#1b110d",
  inkMuted: "#8d7f78",
  // The cream is a light-theme device. On dark it becomes a muted warm surface
  // instead — same job (promo blocks), legible ground.
  cream: "#251a12",

  // Hues held, tints rebuilt: a light pastel background would glow on dark.
  error: "#f97066",
  errorBg: "#2e1512",
  success: "#9ccc4f",
  successBg: "#1c2a10",
  warning: "#e8c45a",
  warningBg: "#332a10",
  info: "#53b1fd",
  infoBg: "#10202e",

  white: "#ffffff",
  black: "#0c0705",
};

export type ThemeName = "light" | "dark";

export const themes: Record<ThemeName, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};
