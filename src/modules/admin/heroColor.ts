/**
 * CAN WHITE BE READ ON THIS COLOUR? — the pre-flight copy.
 *
 * `App\Support\HeroColor` is the gate: the app writes the address, the search
 * hint and the top banner's words in white on the colour an admin picks, so a
 * pale one is refused. This answers the same question while the colour is
 * still being picked, so the preview can say it before Save does. Change both.
 */
export const HERO_MIN_CONTRAST = 3;

/** Dark enough for white type — offered as one-tap choices. */
export const HERO_SWATCHES = ["#03444a", "#c2185b", "#b23a1e", "#1b5e20", "#283593", "#5b2a86", "#0b0d0e"] as const;

/** Picture beside the words, in app points — `BannerRequest::PICTURE_MIN/MAX`. */
export const HERO_PICTURE_MIN = 64;
export const HERO_PICTURE_MAX = 160;
export const HERO_PICTURE_DEFAULT = 112;

export function isHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastWithWhite(hex: string): number {
  return Math.round((1.05 / (luminance(hex) + 0.05)) * 100) / 100;
}

export function readsUnderWhite(hex: string): boolean {
  return isHex(hex) && contrastWithWhite(hex) >= HERO_MIN_CONTRAST;
}
