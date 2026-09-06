import { useTheme } from "../../theme";

/**
 * What a shop looks like before it has uploaded a photograph.
 *
 * ── Why a palette here, when the icon row is one colour ───────────────
 *
 * Those are different jobs. The icon row is a set of CONTROLS and eight hues
 * would be eight accents, none of them meaning anything. A wall of shop cards
 * is standing in for PHOTOGRAPHY, and photographs are all different — a grid
 * where every cover is the same pale tint reads as a page that failed to load,
 * which is exactly how the home screen looked.
 *
 * ── The correction: variety came at the cost of weight ────────────────
 *
 * The first set of six was drawn from the palette's FILLS — #E94E00, #983405,
 * #221711 among them. Each is correct on its own and the set was wrong
 * together, because on a marketplace almost nobody has uploaded a logo yet:
 * two shops in every six came out as a near-black block, and the home screen —
 * a light screen, on a light theme — read as a dark app. The complaint,
 * verbatim: "cards py bht dark color use kia huwa jinki images ni".
 *
 * A placeholder is standing in for a photograph, and its job is to be
 * DISTINGUISHABLE, not to be loud. So the weight moved off the ground and onto
 * the letter: six light grounds far enough apart in hue that a grid still has
 * texture, each with a saturated ink that carries the identity. Nothing here
 * is darker than the page it sits on.
 *
 * ── And it follows the theme now ──────────────────────────────────────
 *
 * The old tones were literal hexes shared by both themes, so the same block
 * that was too dark on white was a glare on near-black. Six pale washes on a
 * dark page would be worse. The dark set below is the same six hues at the
 * other end: deep muted grounds with a light ink, so a placeholder reads as
 * part of the card rather than as a hole in it.
 *
 * ── Why it is derived and not stored ──────────────────────────────────
 *
 * Keyed on the slug, so a shop keeps the same colour on every screen, on every
 * phone, and between launches. A random pick would give one shop two identities
 * in one scroll, and a stored column would be a migration for a decoration.
 */

export interface ShopCover {
  /** The block behind the letter. */
  bg: string;
  /** The letter itself — always legible on `bg`, checked by hand. */
  fg: string;
}

/**
 * Six grounds, each with the ink that reads on it.
 *
 * Spread by HUE rather than by lightness. The previous set varied lightness on
 * purpose, for texture, and that is what made a third of the grid dark; six
 * tints of one weight in six different hues gives the same "these are
 * different things" reading without any of them being heavy.
 *
 * Every pairing below is at least 6:1, which is the level a single large
 * letter needs and comfortably above the 4.5:1 floor.
 */
const LIGHT: ShopCover[] = [
  { bg: "#ffd9c2", fg: "#8f2e00" }, // peach — the brand's own hue
  { bg: "#ffe9cc", fg: "#8a4a00" }, // apricot
  { bg: "#faeec0", fg: "#6a5000" }, // amber
  { bg: "#dfefc4", fg: "#3f5f12" }, // olive
  { bg: "#ffdcd2", fg: "#9a2f16" }, // clay
  { bg: "#ece2da", fg: "#5b483b" }, // sand
];

/** The same six, for a near-black page: deep ground, light ink. */
const DARK: ShopCover[] = [
  { bg: "#3a2318", fg: "#ffb894" },
  { bg: "#3b2a14", fg: "#f5c98a" },
  { bg: "#332d12", fg: "#ebd37e" },
  { bg: "#232d14", fg: "#b9d97f" },
  { bg: "#3a211a", fg: "#ffaf98" },
  { bg: "#2b2420", fg: "#d5c4b6" },
];

/**
 * A stable index for a slug.
 *
 * djb2, because it is four lines and spreads short similar strings — and shop
 * slugs are short and similar ("sweep-mart", "sweep-food"). Summing character
 * codes, the obvious version, gives those two the same colour.
 */
function hash(slug: string): number {
  let h = 5381;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) + h + slug.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * The cover for a seed.
 *
 * `dark` is a parameter rather than a hook so the function stays callable from
 * a test and from a `renderItem` closure. Screens should use `useShopCover()`
 * below, which supplies it from the theme.
 */
export function shopCover(slug: string | null | undefined, dark = false): ShopCover {
  const tones = dark ? DARK : LIGHT;
  if (!slug) return tones[0];
  return tones[hash(slug) % tones.length];
}

/**
 * The cover function, already told which theme it is in.
 *
 * Returned as a function rather than a value because one screen draws covers
 * for a list — a hook per row is not available inside `renderItem`.
 */
export function useShopCover(): (slug: string | null | undefined) => ShopCover {
  const { isDark } = useTheme();
  return (slug) => shopCover(slug, isDark);
}

/** The letter drawn on the cover when a shop has no logo. */
export function shopInitial(name: string | null | undefined): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}
