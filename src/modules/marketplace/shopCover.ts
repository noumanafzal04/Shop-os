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

/**
 * THE SHOP'S PICTURE, or null if it has none.
 *
 * ── The bug this is the fix for ──────────────────────────────────────
 *
 * Every screen read `shop.logo_path` and handed it to `<Image source={{ uri }}>`.
 * That field is a STORAGE PATH — `logos/{id}/abc.png` — and React Native
 * cannot resolve a relative path, so a shop that had uploaded a logo showed
 * the derived letter and was indistinguishable from a shop that had not.
 * `TenantResource` had carried the absolute URL for the panel since it was
 * written; the marketplace payload only just gained it.
 *
 * ── Why a function and not a field read at each site ─────────────────
 *
 * Five screens read this, and an APK already in somebody's hand is still
 * being served payloads that may carry only the path. One place decides what
 * "the picture" means, so the fallback exists once rather than five times —
 * and an absolute `logo_path` from some older build still works, because the
 * test is whether it looks like a URL rather than which field it arrived in.
 */
export function shopLogo(shop: {
  logo_url?: string | null;
  logo_path?: string | null;
}): string | null {
  if (shop.logo_url) return shop.logo_url;

  // Only if it is already absolute. A bare path is worse than nothing: it
  // makes `SmartImage` wait for an image that can never arrive, so the letter
  // it would have drawn immediately shimmers first.
  return shop.logo_path?.startsWith("http") ? shop.logo_path : null;
}

/**
 * THE WIDE PICTURE, for a slot shaped like a band.
 *
 * ── "home py shop ki cover image show ni ho rhi" ─────────────────────
 *
 * It never did. The home rail's card is 264 wide with a 120pt band across the
 * top of it — the slot every marketplace puts a photograph in — and what it
 * drew there was `shopLogo(shop)`. So the one screen that has room for a
 * shop's own picture showed its LOGO, and a shop that had uploaded a cover and
 * no logo showed a letter. The field was in the payload; nothing read it.
 *
 * `cover_url` is reached for first because that is the image a shop uploads
 * FOR this shape — see `ShopController::uploadCover` — and a logo is the
 * fallback rather than the other way round.
 *
 * ── Why the kind comes back with the URL ─────────────────────────────
 *
 * `SmartImage` crops to fill by default, which is right for a photograph and
 * wrong for a logo: a square mark cropped into a 120×264 band is a slice out
 * of its middle, usually the part with no words in it. The caller needs to
 * know which one it got, and deciding that at the call site by re-reading the
 * fields is how the two halves drift apart.
 */
export type ShopBanner = { uri: string | null; kind: "cover" | "logo" | null };

export function shopBanner(shop: {
  cover_url?: string | null;
  logo_url?: string | null;
  logo_path?: string | null;
}): ShopBanner {
  if (shop.cover_url) return { uri: shop.cover_url, kind: "cover" };

  const logo = shopLogo(shop);
  return logo ? { uri: logo, kind: "logo" } : { uri: null, kind: null };
}

/**
 * THE SMALL SQUARE ONE — a row's avatar, a basket's line, a suggestion.
 *
 * The other way round from `shopBanner`, and for the same reason: a logo is
 * drawn to be read at 44 points and a cover is not. A cover is still better
 * than a letter, so it is the fallback rather than nothing.
 */
export function shopAvatar(shop: {
  cover_url?: string | null;
  logo_url?: string | null;
  logo_path?: string | null;
}): string | null {
  return shopLogo(shop) ?? shop.cover_url ?? null;
}
