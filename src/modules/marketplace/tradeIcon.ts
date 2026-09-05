import type { BrowseFilters } from "./services/marketplaceService";
import {
  BadgePercent,
  BookOpen,
  Car,
  CircleHelp,
  Croissant,
  Drill,
  Fuel,
  Footprints,
  Landmark,
  Package,
  Pill,
  Scissors,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Star,
  Store,
  Utensils,
  Wrench,
  type LucideIcon,
} from "lucide-react-native";

/**
 * The icon for a kind of shop.
 *
 * ── Why not emoji ──────────────────────────────────────────────────────
 *
 * Every one of these was an emoji, which is the fastest way to get something
 * on screen and the wrong thing to ship. An emoji is drawn by the phone's own
 * font, so the app has no say in its weight, its colour or its size — 🏬 and
 * 🛍️ arrived in different visual weights, at different optical sizes, in a row
 * that is meant to read as one set of buttons. It also looks different on every
 * Android skin, which is not a design so much as a hope.
 *
 * Lucide is already a dependency, draws at the stroke weight the rest of the
 * app uses, and takes the theme's colour like everything else.
 *
 * ── Why the ROW is one colour ─────────────────────────────────────────
 *
 * Six different hues would be six accents, and a screen with six accents has
 * none. The tile is the brand's own soft tint and the GLYPH carries the
 * difference — which is what makes a row of them read as a set rather than as
 * six unrelated stickers.
 */

const BY_TRADE: Record<string, LucideIcon> = {
  // Current trade codes.
  food: Utensils,
  // A BASKET, not a cart. The tab bar draws this beside the basket button,
  // which is a cart — two shopping trolleys in a five-item bar, one meaning
  // "groceries" and one meaning "what you are buying right now".
  mart: ShoppingBasket,
  pharmacy: Pill,
  retail: ShoppingBag,
  services: Wrench,
  automotive: Car,
  petroleum: Fuel,
  finance: Landmark,

  // Older codes that still reach the app from a shop created before the
  // current set — a missing icon is a blank square on a home screen, so they
  // keep their glyph rather than falling through.
  restaurant: Utensils,
  grocery: ShoppingBasket,
  clinic: Pill,
  salon: Scissors,
  workshop: Drill,
  service: Wrench,
  wholesale: Package,
  books: BookOpen,
  hardware: Wrench,
  bakery: Croissant,
  general: Store,
};

/** Never null: an unknown trade gets a question mark, not an empty tile. */
export function tradeIcon(trade: string | null | undefined): LucideIcon {
  if (!trade) return Store;
  return BY_TRADE[trade] ?? CircleHelp;
}

/** What the four shortcut tiles above the shop rows point at. */
export interface Shortcut {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Offers earn the warm accent; the rest stay in the brand family. */
  tone?: "offer";
  /** What this shortcut actually narrows. Not optional — see below. */
  filters: BrowseFilters;
}

/**
 * The four shortcuts, and the filter each one actually applies.
 *
 * ── Why the filter is part of the definition ─────────────────────────
 *
 * All four used to navigate to the shop list passing nothing but a TITLE. So
 * "Offers", "Pick-up", "New shops" and "Top rated" were four buttons that
 * produced the identical unfiltered list of every shop, each with a different
 * heading over it — the heading being the whole of the claim.
 *
 * Keeping the filter here, beside the label, is what stops that coming back: a
 * shortcut cannot be added without saying what it narrows.
 *
 * "Pick-up" is gone rather than fixed. `pickup_enabled` defaults to TRUE for
 * every shop, so filtering on it would return the entire marketplace — a
 * correct filter and a useless shortcut. "Under Rs 500" is a question people
 * genuinely ask and the aisle can genuinely answer.
 */
export const SHORTCUTS: Shortcut[] = [
  { key: "offers", label: "Offers", icon: BadgePercent, tone: "offer", filters: { on_sale: true, sort: "discount" } },
  { key: "cheap", label: "Under Rs 500", icon: Footprints, filters: { max_price: 500, sort: "price_asc" } },
  { key: "new", label: "New arrivals", icon: Sparkles, filters: { sort: "newest" } },
  { key: "top", label: "Top rated", icon: Star, filters: { rating_min: 4, sort: "rating" } },
];
