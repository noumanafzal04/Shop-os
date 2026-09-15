import React from "react";
import { useTheme } from "../../theme";
import { type Icon } from "../../common/ui/icons";
import { SHORTCUTS, tradeIcon } from "./tradeIcon";

/**
 * THE CATEGORY TILES, and the second time they have been rebuilt.
 *
 * ── What was here, and why it went ───────────────────────────────────
 *
 * Twelve hand-authored flat illustrations — a burger with three sesame seeds,
 * a basket with two slats, a capsule on the diagonal. Roughly three hundred
 * lines of `react-native-svg` primitives, written because the ask was "flat
 * illustrated icons per category, like the apps people already use".
 *
 * The report on them was: "fake sy icon lg rhy, emoji" — and it is right. A
 * multi-coloured cartoon of a burger next to a multi-coloured cartoon of a car
 * reads as a sticker sheet, not as a set of controls. The irony is exact:
 * `tradeIcon.tsx` already carried a docblock explaining why the ORIGINAL
 * emoji were removed, and the illustrations that replaced its glyphs landed
 * back in the same place by a longer road.
 *
 * ── What they are now ────────────────────────────────────────────────
 *
 * Phosphor glyphs — the family the tab bar, the menus and every row in this
 * app already draw from — on a soft per-trade plate, with the glyph in a
 * deeper tone of that same plate.
 *
 * One family means one weight, one optical size and one visual language at
 * every size the app renders them. That is the whole difference between
 * "designed" and "assembled".
 *
 * ── Why the plate is tinted at all ───────────────────────────────────
 *
 * `tradeIcon.tsx` argues the row should be ONE colour: six hues are six
 * accents, and a screen with six accents has none. That argument is about
 * ACCENTS — saturated colour competing for the eye — and it still holds
 * everywhere below these tiles.
 *
 * These are not accents. They are grounds at roughly 8% saturation, and the
 * glyph on top is a desaturated mid-tone rather than a brand colour. Nothing
 * in the pair is loud enough to pull the eye from the one real accent on the
 * page, and the difference in hue is what lets a thumb find "pharmacy" in a
 * grid of eight without reading a word. A category row is the one place that
 * trade is worth making.
 *
 * ── The pairs ────────────────────────────────────────────────────────
 *
 * Every entry is [light theme, dark theme], the same arrangement `shopCover`
 * uses and for the same reason: a tint that reads as paper at noon is a bright
 * patch at midnight, so each carries both and the hook picks.
 */

export interface TileArt {
  /** The plate behind the glyph: [light, dark]. */
  ground: readonly [string, string];
  /** The glyph itself, a deeper tone of the plate: [light, dark]. */
  tint: readonly [string, string];
  /** Phosphor, from the app's own set. */
  Icon: Icon;
}

/**
 * The hues. Each is a family — a wash for the plate and a mid-tone for the
 * glyph — so a tile is one colour at two strengths rather than two colours.
 */
const HUE = {
  orange: { ground: ["#fff1e6", "#3a2517"], tint: ["#c04000", "#fb7331"] },
  green: { ground: ["#eef6e4", "#22301a"], tint: ["#5d8a22", "#9ccc51"] },
  blue: { ground: ["#e9f2fd", "#16253a"], tint: ["#1f6fc4", "#7fb8f0"] },
  amber: { ground: ["#fdf6e4", "#312812"], tint: ["#a8871f", "#ebc249"] },
  slate: { ground: ["#eef0f3", "#23272c"], tint: ["#5d6470", "#a8b0bb"] },
  plum: { ground: ["#f6edf7", "#2c1c30"], tint: ["#8a4d97", "#c58fcf"] },
  teal: { ground: ["#e6f4f2", "#14302c"], tint: ["#1f7a6d", "#69c3b4"] },
} as const;

type HueName = keyof typeof HUE;

/**
 * A hue per trade.
 *
 * Chosen so that no two trades a shopper is likely to confuse sit next to each
 * other in the same colour — food and mart are the two most-tapped and are
 * deliberately far apart. The grid orders by shop count, so which tiles end up
 * adjacent changes per city; the hues have to survive any arrangement.
 */
const TRADE_HUE: Record<string, HueName> = {
  food: "orange",
  restaurant: "orange",
  // A bakery is food, and the guard in `tileArt.test.tsx` is what said so: it
  // reads every code `tradeIcon` maps and fails on any this file has not
  // answered for. Without it `bakery` and `general` would have fallen to the
  // grey default — a correct fallback and the wrong colour for a cake shop.
  bakery: "orange",
  mart: "green",
  grocery: "green",
  pharmacy: "blue",
  clinic: "blue",
  retail: "plum",
  wholesale: "plum",
  books: "plum",
  services: "slate",
  service: "slate",
  salon: "plum",
  workshop: "slate",
  hardware: "slate",
  automotive: "blue",
  petroleum: "amber",
  online: "teal",
  finance: "teal",
  // The shopfront every unknown code lands on. Named rather than left to the
  // default so the fallback is a decision.
  general: "slate",
};

/** The four aisle shortcuts, which are filters rather than trades. */
const SHORTCUT_HUE: Record<string, HueName> = {
  offers: "amber",
  cheap: "green",
  new: "teal",
  top: "amber",
};

function make(hue: HueName, Icon: Icon): TileArt {
  const { ground, tint } = HUE[hue];

  return {
    ground,
    tint,
    Icon,
  };
}

export function tradeArt(type: string | null | undefined): TileArt {
  const code = (type ?? "").toLowerCase();

  return make(TRADE_HUE[code] ?? "slate", tradeIcon(code));
}

export function shortcutArt(key: string): TileArt | null {
  const hue = SHORTCUT_HUE[key];
  if (hue === undefined) return null;

  // The glyph comes from the shortcut's own definition, so a shortcut cannot
  // wear one icon here and another in the list it opens.
  const shortcut = SHORTCUTS.find((x) => x.key === key);

  return shortcut === undefined ? null : make(hue, shortcut.icon);
}

/**
 * The plate colour for the theme that is on.
 *
 * A hook rather than a constant for the same reason `useShopCover` is one: the
 * wash that reads as paper at noon is a bright patch at midnight, so each pair
 * carries both and this picks.
 */
export function useTileGround(): (art: TileArt) => string {
  const { isDark } = useTheme();

  return React.useCallback((art: TileArt) => art.ground[isDark ? 1 : 0], [isDark]);
}

/** The glyph colour, for the same reason and from the same pair. */
export function useTileTint(): (art: TileArt) => string {
  const { isDark } = useTheme();

  return React.useCallback((art: TileArt) => art.tint[isDark ? 1 : 0], [isDark]);
}
