import { brand, cream, dealOrange, gray, green, gradients, ink, meadow, tealBrand, tealDarkBrand, tealDarkGray, tealGray, tealSignal, warm, type ColorScale } from "./tokens";

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

  /**
   * THE BRAND'S SECOND VOICE — and why it is not just another green.
   *
   * `warm` says "look at this" and `success` says "that worked". Neither says
   * the third thing a marketplace says constantly: *this is fresh, this is
   * free, this is included*. A free delivery badge drawn in `success` claims
   * something happened; drawn in `warm` it claims a discount. Both were being
   * used for it, in different files, which is how one app grows two
   * vocabularies.
   *
   * So `accent` is a STATE OF THE THING, not a state of the system. It is the
   * fresh half of the ramp on the shopping side, and it is deliberately a
   * colour nothing tappable may use — same rule as `warm`, for the same
   * reason: a screen with two primaries has none.
   */
  accent: string;
  /** A tinted ground for an accent chip. Body `text` is legible on it. */
  accentSoft: string;
  /** Text and icons sitting ON an `accent` fill. */
  onAccent: string;

  /**
   * THE HERO GROUND — a ramp with WORDS ON IT.
   *
   * Three stops, darkest first, because the first stop is where the status
   * bar and the first line of type land. See `gradients` in `tokens.ts` for
   * why three and not ten.
   *
   * ── It is the deep half only, and that was a correction ─────────
   *
   * This started as the whole reference strip, lime through to ocean, drawn
   * diagonally. On a phone it was immediately wrong: the lime corner carried
   * the notification bell at 1.2:1, and the flat band the status bar sits on
   * could match one end of a diagonal or the other but never both — so the
   * top of the screen had a visible seam running across it.
   *
   * The fresh half of the strip is a FILL FOR DARK TEXT, which is what
   * `accent` and `accentSoft` are. This is the other job, and a token that
   * tries to do both ends up legible at neither end.
   *
   * It lives on the THEME rather than being imported straight from the tokens
   * because a gradient is a ground, and a ground that does not change between
   * light and dark is the same bug as a shared grey: correct on the theme it
   * was designed in, glowing on the other one.
   */
  gradient: readonly [string, string, string];

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

  // The carmine side's fresh green is the one it already owns — `green` is
  // what `success` is drawn in here, one step lighter so a fill and a
  // confirmation are not the same swatch.
  accent: green[500],
  accentSoft: green[100],
  onAccent: "#1b2b08",
  // Darkest first — see the interface. The brand's own reds, deep enough
  // that white type is readable the whole way down.
  gradient: [brand[800], brand[600], brand[500]] as const,

  // Same move as the meadow side — see the note there.
  bg: "#f0ebe7",
  surface: "#ffffff",
  surfaceAlt: "#e7ded8",
  // 1.24:1 and a third of a pixel — see the note on the meadow side. Same
  // defect, same fix; fixing one palette and leaving the other is how a design
  // system grows a second personality.
  border: "#e2d9d3",

  text: gray[900],
  textSecondary: gray[600],
  // 3.4:1, not `gray[400]`'s 2.35:1 — see the meadow side for the whole note.
  textMuted: "#857a73",
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
  // Measured, and the same in both modes (2026-11-13): #157F3C is 5.1:1 on
  // white where the olive it replaces was not a text colour at all.
  success: "#157f3c",
  successBg: "#ecfdf3",
  // The DARKER step: warning copy is text, and warm[500] is a fill.
  warning: "#b54708",
  warningBg: "#fffaeb",
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

  accent: "#9ccc4f",
  accentSoft: "#1c2a10",
  onAccent: "#0f1a06",
  gradient: ["#2c0b0b", "#3f1010", "#5a1717"] as const,

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
 * ── THE SHOPPING SIDE: MEADOW ─────────────────────────────────────────
 *
 * Same app, same shapes, one hue family swapped: the working side keeps the
 * brand's carmine and the shopping side wears the ten-step reference strip in
 * `tokens.ts` — lime #D9ED92 down to ocean #184E77.
 *
 * ── Why the primary sits at the DEEP end of a palette named for a meadow ──
 *
 * The strip's own lightness curve decides it. Measured against white:
 *
 *   #D9ED92  1.27    #76C893  2.01    #168AAD  3.98
 *   #B5E48C  1.45    #52B69A  2.47    #1A759F  5.14   <- the primary
 *   #99D98C  1.66    #34A0A4  3.13    #1E6091  6.69
 *
 * A primary is a FILL WITH A LABEL ON IT, so the question is not which
 * swatch is prettiest but which one a button label can be read on. Only the
 * last three clear 4.5:1 against white, and #1A759F is the lightest of them
 * — the most colour the palette can give while the label stays legible at
 * body size. One step up, #168AAD, is 3.98:1: fine for an icon, not for the
 * word "Checkout".
 *
 * That is the same reasoning the emerald palette this replaced went through
 * and came out the other side of: #10B981 measured 2.54:1, so its labels had
 * to be INK rather than white, and every solid button in the app carried a
 * dark label. This palette does not have to make that trade — which is worth
 * saying out loud, because "we can use white again" is the practical
 * difference a shopper notices and the contrast table above is the reason.
 *
 * ── Where the greens went ─────────────────────────────────────────────
 *
 * Nowhere. The fresh half is the `accent` pair — offer pills, free-delivery
 * badges, the tinted ground on a selected chip — and all three gradient
 * stops. A palette's loudest colours do not have to be its primary; they
 * have to be findable, and an offer badge is the single most-looked-at thing
 * on a marketplace home screen.
 */




/**
 * One theme, re-keyed to a different brand scale.
 *
 * `over` exists because a brand is not only a hue — it also decides what can
 * legibly sit ON it, and what the rest of the palette must move out of its
 * way. On this palette the corrections are the neutrals (above), the inks
 * (a warm near-black under a cool brand is the same defect at a larger size)
 * and `error`, which is free to be a true red here precisely because the
 * brand is not one.
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
 * THE CUSTOMER'S APP WEARS TRUE SERVE TEAL (2026-11-13).
 *
 * Kept under the name `meadow` so every reader of it keeps working; what it
 * wears is the brand measured against the app icon (palette B, see
 * `tealBrand`). One brand colour on a few high-value things — the primary
 * button, the header, the selected chip, the active tab — greys for
 * everything else, and orange for deals only (`warm`). Prices are never
 * brand-coloured.
 *
 * Contrast, measured: white on primary 10.9:1 · text on page 15.4:1 ·
 * secondary text 5.5:1 · white on the deal orange 5.1:1 · the deal orange on
 * its tint 4.7:1 · success 5.1:1 · error on its tint 6.1:1.
 */
export const meadowLightColors: ThemeColors = wearing(lightColors, tealBrand, {
  gray: tealGray,

  bg: tealGray[50],
  surface: "#ffffff",
  surfaceAlt: tealGray[100],
  border: tealGray[200],

  text: tealGray[900],
  textSecondary: tealGray[600],
  textMuted: tealGray[500],
  textInverse: "#ffffff",

  ink: tealGray[900],
  inkSoft: tealGray[700],
  inkMuted: tealGray[600],

  // Deals and only deals: the offer badge, the banner's call, the coupon.
  warm: dealOrange.base,
  warmSoft: dealOrange.soft,
  onWarm: "#ffffff",

  // The signal teal: progress, the route, a spinner — never text.
  accent: tealSignal,
  accentSoft: tealBrand[50],
  onAccent: tealGray[900],

  // The header: deep teal, a breath lighter at the far edge.
  gradient: [tealBrand[700], tealBrand[500], "#0b5e66"] as const,

  error: "#b42318",
  errorBg: "#fef3f2",
  info: tealBrand[500],
  infoBg: tealBrand[50],
});

/**
 * The same brand after dark: the primary fill turns to mist and carries the
 * deep teal as its label (6.6:1); the deal orange lightens to read on a dark
 * surface (7.5:1). Light ships first; this keeps the dark mode honest.
 */
export const meadowDarkColors: ThemeColors = wearing(darkColors, tealDarkBrand, {
  gray: tealDarkGray,
  bg: tealDarkGray[50],
  surface: tealDarkGray[100],
  surfaceAlt: tealDarkGray[200],
  border: tealDarkGray[300],
  text: tealDarkGray[900],
  textSecondary: tealDarkGray[600],
  textMuted: tealDarkGray[500],
  ink: "#0b0d0e",
  inkSoft: tealDarkGray[100],
  inkMuted: tealDarkGray[600],
  onPrimary: tealBrand[500],
  warm: dealOrange.light,
  warmSoft: "#2e1a10",
  onWarm: tealGray[900],
  accent: tealSignal,
  accentSoft: tealDarkBrand[50],
  onAccent: tealGray[900],
  gradient: ["#01191c", "#022f33", "#03444a"] as const,
  error: "#f97066",
  errorBg: "#2e1512",
  info: tealDarkBrand[500],
  infoBg: tealDarkBrand[50],
});

export type ThemeName = "light" | "dark";

/**
 * The two palettes, named for what they ARE.
 *
 * They were `themes` and `riderThemes` — a name that says where a colour is
 * USED, which lasted until the two were swapped over and every name became a
 * lie. `carmine` is the brand's red and `meadow` is the lime-to-ocean strip;
 * which side of the app wears which is a decision that lives in one line of
 * `palettes.ts`, and can move again without renaming anything.
 *
 * This set was `emeraldThemes` until the strip replaced #10B981. Renaming the
 * scale when the hue family moves is part of that bargain and not an extra —
 * `emerald` describing an ocean blue would have been the same lie again, and
 * this file has already paid for that twice.
 */
export const carmineThemes: Record<ThemeName, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};

export const meadowThemes: Record<ThemeName, ThemeColors> = {
  light: meadowLightColors,
  dark: meadowDarkColors,
};

export const themes: Record<ThemeName, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};
