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
 * The tones stay inside the brand's own family — reds, ambers, a warm ink —
 * so the variety is a texture rather than a second design.
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
 * Deliberately unequal in lightness: six tints of one weight would give the
 * variety without the texture, and the grid would still look flat.
 */
const TONES: ShopCover[] = [
  { bg: "#E94E00", fg: "#FFFFFF" }, // the brand
  { bg: "#FB7331", fg: "#3A1A00" }, // the accent
  { bg: "#EBC249", fg: "#3A2A00" }, // amber
  { bg: "#80B931", fg: "#1E2E08" }, // green
  { bg: "#983405", fg: "#FFE4D3" }, // deep
  { bg: "#221711", fg: "#FFC3A2" }, // ink
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

export function shopCover(slug: string | null | undefined): ShopCover {
  if (!slug) return TONES[0];
  return TONES[hash(slug) % TONES.length];
}

/** The letter drawn on the cover when a shop has no logo. */
export function shopInitial(name: string | null | undefined): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}
