import type { BrowseFilters } from "./services/marketplaceService";
import {
  BagIcon,
  BankIcon,
  BasketIcon,
  BookIcon,
  BoxIcon,
  CarIcon,
  CoinsIcon,
  CroissantIcon,
  DrillIcon,
  FuelIcon,
  PillIcon,
  QuestionIcon,
  ScissorsIcon,
  SparkleIcon,
  StarIcon,
  StorefrontIcon,
  TagIcon,
  UtensilsIcon,
  WrenchIcon,
  type Icon,
} from "../../common/ui/icons";

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
 * These are Phosphor's drawings, the same set the tab bar and the menus use —
 * so a trade tile, a menu row and the bar underneath are one family rather
 * than three. See `common/ui/icons`.
 *
 * ── Why the ROW is one colour ─────────────────────────────────────────
 *
 * Six different hues would be six accents, and a screen with six accents has
 * none. The tile is the brand's own soft tint and the GLYPH carries the
 * difference — which is what makes a row of them read as a set rather than as
 * six unrelated stickers.
 */

const BY_TRADE: Record<string, Icon> = {
  // Current trade codes.
  food: UtensilsIcon,
  // A BASKET, not a cart. The tab bar draws this beside the basket button,
  // which is a cart — two shopping trolleys in a five-item bar, one meaning
  // "groceries" and one meaning "what you are buying right now".
  mart: BasketIcon,
  pharmacy: PillIcon,
  retail: BagIcon,
  services: WrenchIcon,
  automotive: CarIcon,
  petroleum: FuelIcon,
  finance: BankIcon,

  // Older codes that still reach the app from a shop created before the
  // current set — a missing icon is a blank square on a home screen, so they
  // keep their glyph rather than falling through.
  restaurant: UtensilsIcon,
  grocery: BasketIcon,
  clinic: PillIcon,
  salon: ScissorsIcon,
  workshop: DrillIcon,
  service: WrenchIcon,
  wholesale: BoxIcon,
  books: BookIcon,
  hardware: WrenchIcon,
  bakery: CroissantIcon,
  general: StorefrontIcon,
};

/** Never null: an unknown trade gets a question mark, not an empty tile. */
export function tradeIcon(trade: string | null | undefined): Icon {
  if (!trade) return StorefrontIcon;
  return BY_TRADE[trade] ?? QuestionIcon;
}

/** What the four shortcut tiles above the shop rows point at. */
export interface Shortcut {
  key: string;
  label: string;
  icon: Icon;
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
  { key: "offers", label: "Offers", icon: TagIcon, tone: "offer", filters: { on_sale: true, sort: "discount" } },
  { key: "cheap", label: "Under Rs 500", icon: CoinsIcon, filters: { max_price: 500, sort: "price_asc" } },
  { key: "new", label: "New arrivals", icon: SparkleIcon, filters: { sort: "newest" } },
  { key: "top", label: "Top rated", icon: StarIcon, filters: { rating_min: 4, sort: "rating" } },
];
