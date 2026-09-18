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
  50: "#2c0b0b",
  100: "#3f1010",
  200: "#5a1717",
  300: "#7f2020",
  400: "#c23b3b",
  // 500: the brand at full strength, the index the screens ask for.
  500: "#f87171",
  // 600–900: LOUDER than full strength. In light that means darker; on a dark
  // ground the only direction left is brighter, so a pressed button lifts
  // instead of sinking. Same semantics, opposite pigments — which is the whole
  // reason this scale is written out rather than reused.
  600: "#fc8f8f",
  700: "#fcabab",
  800: "#fecaca",
  900: "#fee2e2",
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

  /**
   * THE BRAND IS RED NOW, SO THIS CANNOT BE.
   *
   * This was #d92d20, chosen when the brand was an orange-red: "at hue 4
   * against the brand's 20 they are told apart at a glance". That sentence
   * stopped being true the moment the brand moved to #ef4444 — the two
   * measure **1.28:1** against each other, which is not a distinction, it is
   * the same colour twice.
   *
   * Moved deeper and toward magenta so a refusal still reads as a refusal
   * beside a brand-red control. It is a compromise and worth naming as one:
   * the strongest version of this palette would keep destructive red and move
   * the BRAND off it. Mitigated rather than solved, and the mitigation holds
   * because `error` here is almost entirely TEXT — this app draws no filled
   * danger button today.
   */
  error: "#9f1239",
  errorBg: "#fff1f2",
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
  /**
   * The dark half of the same compromise — see `error` in `lightColors`.
   *
   * Told apart from the brand by LIGHTNESS rather than hue here: on a dark
   * ground an error has to be pale to be read at all, and #f87171 is already
   * pale. Staying in the red family is deliberate — a pink or fuchsia would
   * separate further and stop reading as danger, which is the only job this
   * colour has.
   */
  error: "#fecdd3",
  errorBg: "#2c0d17",
  success: "#9ccc4f",
  successBg: "#1c2a10",
  warning: "#e8c45a",
  warningBg: "#332a10",
  info: "#53b1fd",
  infoBg: "#10202e",

  white: "#ffffff",
  black: "#0c0705",
};

/**
 * ── THE RIDER'S OWN COLOUR ────────────────────────────────────────────
 *
 * "rider ka theme seprate kro." Same app, same shapes, one hue swapped: the
 * shopping side is the brand's red-orange and the working side is green.
 *
 * ── Why green, and why not a third colour ────────────────────────────
 *
 * Green is already this app's word for "go" — it is what `success` is drawn
 * in, and what the online toggle turns when a rider starts a shift. Making it
 * the rider side's PRIMARY means the whole screen agrees with the one control
 * that matters most there, instead of a red button sitting on a green
 * "online" pill.
 *
 * It also solves a problem the mode switch has: two navigators that look
 * identical, and a rider who is not sure which one they are in. A hue is
 * readable from across a room.
 *
 * Nothing else moves. The greys, the surfaces, the borders, the type and the
 * spacing are shared, because this is one app wearing a different badge — not
 * a second design that will drift.
 */
const emeraldBrand: ColorScale = {
  50: "#ecfdf5",
  100: "#d1fae5",
  200: "#a7f3d0",
  300: "#6ee7b7",
  400: "#34d399",
  /**
   * 500: the shopping side's full strength — #10B981, given directly.
   *
   * It measures **2.54:1 against white**, which clears neither AA text (4.5)
   * nor the 3:1 floor for a UI component. That is not a reason to refuse the
   * colour; it is a reason to stop putting white on it. Against this app's ink
   * it measures 6.91:1, and the reference screens this came from never used
   * the green as a button — it was a pin, a dot, an active state, with the
   * buttons in a dark navy.
   *
   * So `onPrimary` is INK on this palette, not white. See `wearing` below,
   * which is the only place that difference is written.
   */
  500: "#10b981",
  600: "#059669",
  700: "#047857",
  800: "#065f46",
  900: "#064e3b",
};

const emeraldDarkBrand: ColorScale = {
  50: "#022c22",
  100: "#04372b",
  200: "#065f46",
  300: "#047857",
  400: "#059669",
  // Brighter than full strength on a dark ground, so a pressed control lifts
  // rather than sinks — the same rule as `darkBrand` above. Brighter also
  // buys back the contrast the light theme had to spend: white on #34d399 is
  // not the question on a dark page, ink on it is.
  500: "#34d399",
  600: "#6ee7b7",
  700: "#a7f3d0",
  800: "#d1fae5",
  900: "#ecfdf5",
};

/**
 * One theme, re-keyed to a different brand scale.
 *
 * `over` exists because a brand is not only a hue — it also decides what can
 * legibly sit ON it, and what the rest of the palette must move out of its
 * way. Two corrections are passed today and both are measured, not felt:
 *
 *   onPrimary  white on #10b981 is 2.54:1, under even the 3:1 floor for a UI
 *              component. Ink on it is 6.91:1.
 *   error      when the brand itself is red, a refusal drawn in a second red
 *              is not a refusal. #ef4444 against #d92d20 measures 1.28:1 —
 *              the two are the same colour to a reader.
 */
const wearing = (
  base: ThemeColors,
  scale: ColorScale,
  over: Partial<ThemeColors> = {},
): ThemeColors => ({
  ...base,
  brand: scale,
  primary: scale[500],
  primaryPressed: scale[600],
  primarySoft: scale[50],
  ...over,
});

/**
 * The shopping side. Ink on the green, and a TRUE red for refusals — which is
 * free here precisely because the brand is not red.
 */
export const emeraldLightColors: ThemeColors = wearing(lightColors, emeraldBrand, {
  onPrimary: ink.base,
  /**
   * 700, not the usual 600.
   *
   * `primaryPressed` is the pressed state AND, on this palette, the only
   * brand shade that can be READ. #10b981 on the pale tint measures 2.41:1 —
   * the app already hit this once with a different green and left the note
   * in `CustomerHomeScreen`: "primarySoft behind a brand glyph measured
   * 1.4:1 and read as disabled". 700 on that tint is 5.21:1.
   *
   * So on the green side a brand-coloured mark — a chip label, a glyph on a
   * tinted ground — takes `primaryPressed`, and `primary` is for FILLS.
   * `riderTheme.test.tsx` asserts it.
   */
  primaryPressed: emeraldBrand[700],
  error: "#d92d20",
  errorBg: "#fdf3f2",
});
export const emeraldDarkColors: ThemeColors = wearing(darkColors, emeraldDarkBrand, {
  onPrimary: "#04231a",
  error: "#f97066",
  errorBg: "#2e1512",
});

export type ThemeName = "light" | "dark";

/**
 * The two palettes, named for what they ARE.
 *
 * They were `themes` and `riderThemes` — a name that says where a colour is
 * USED, which lasted until the two were swapped over and every name became a
 * lie. `ember` is the brand's red-orange and `leaf` is the green; which side
 * of the app wears which is a decision that lives in one line of
 * `ThemeProvider`, and can move again without renaming anything.
 */
export const carmineThemes: Record<ThemeName, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};

export const emeraldThemes: Record<ThemeName, ThemeColors> = {
  light: emeraldLightColors,
  dark: emeraldDarkColors,
};

export const themes: Record<ThemeName, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};
