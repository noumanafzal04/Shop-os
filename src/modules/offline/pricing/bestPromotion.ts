import { round2 } from "./money";
import type { CatalogPromotion } from "../sync/catalogService";

/**
 * The best live promotion for a cart, with no server.
 *
 * A MIRROR of `PromotionService`, and the reason it exists is worth writing
 * down: the first real run of the shadow check produced nine disagreements,
 * every one of them a shop's "Weekend 10% Off" that the server applied and the
 * till did not. Nobody was mis-billed — the customer pays the server's price —
 * but a till allowed to sell offline would have printed a receipt ten per cent
 * too high on every sale of the day.
 *
 * ── What it deliberately still does NOT do ──────────────────────────────
 *
 * Coupons, loyalty and customer-group discounts remain absent, and that is the
 * offline allow-list rather than an omission: each is shared state that a
 * single till cannot decide alone. Promotions are different — an automatic
 * promotion is a rule the shop wrote down in advance, the same rule for every
 * till, with nothing to reserve and nothing to race over. It is decidable
 * alone, which is exactly why it belongs here.
 *
 * ── The clock is the shop's, not the tablet's ───────────────────────────
 *
 * A promotion that runs on Fridays, or between six and nine in the evening, is
 * a statement about LOCAL time. A till that read its own clock would run a
 * flash sale that ended yesterday, and one that read UTC would open a Karachi
 * shop's evening sale five hours early. So the caller passes server time
 * (measured drift already applied) and the shop's timezone, and every window
 * below is judged in that.
 */

/** One cart line, as the promotion rules need to see it. */
export interface PromoLine {
  productId: string;
  categoryId: string | null;
  quantity: number;
  /** After any per-line discount — the server passes the same figure. */
  lineTotal: number;
}

export interface PromoResult {
  id: string;
  name: string;
  discount: number;
}

/**
 * Types this engine can evaluate.
 *
 * Anything else is not guessed at. See `unsupportedPromotions` — a shop with a
 * promotion this cannot do must not sell offline at all, because a till that
 * silently skips one prints the wrong price on every cart it touches.
 */
export const SUPPORTED_TYPES = ["percent", "fixed", "bogo"] as const;

/** Parts of a date, in a named timezone. The shop's calendar, not the tablet's. */
function shopClock(at: Date, timezone: string): { date: string; weekday: number; time: string } {
  // `en-CA` gives YYYY-MM-DD, which sorts and compares as a string — the same
  // shape `starts_on` and `ends_on` arrive in.
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(at);

  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(at);

  // Carbon's `dayOfWeek` is 0 = Sunday, and the stored `days_of_week` follow it.
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);

  return { date, weekday, time };
}

/** "18:00" and "18:00:00" are the same instant; the server pads the short one. */
function hms(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

/** Is this promotion live right now — date range, weekday, and time window? */
export function liveNow(promo: CatalogPromotion, at: Date, timezone: string): boolean {
  if (promo.is_active === false) return false;

  const { date, weekday, time } = shopClock(at, timezone);

  if (promo.starts_on !== null && promo.starts_on !== undefined && date < promo.starts_on) {
    return false;
  }
  if (promo.ends_on !== null && promo.ends_on !== undefined && date > promo.ends_on) {
    return false;
  }

  const days = promo.days_of_week ?? [];
  if (days.length > 0 && !days.map(Number).includes(weekday)) {
    return false;
  }

  if (promo.start_time && promo.end_time) {
    const from = hms(promo.start_time);
    const to = hms(promo.end_time);
    // A window that wraps midnight (22:00–02:00) is handled, as on the server.
    const inWindow = from <= to ? time >= from && time <= to : time >= from || time <= to;
    if (!inWindow) return false;
  }

  return true;
}

/** Does a line fall in this promotion's scope? */
function matches(promo: CatalogPromotion, line: PromoLine): boolean {
  return promo.scope === "category"
    ? line.categoryId === promo.category_id
    : (promo.product_ids ?? []).includes(line.productId);
}

/**
 * Buy-X-get-Y.
 *
 * For every (buy + get) matching whole units, `get` of the CHEAPEST come off at
 * `get_discount_pct` (absent means free). Whole units only — a line sold by
 * weight contributes only its whole part. The per-unit price is the line's
 * effective rate (line total ÷ quantity), so a per-line discount already flows
 * through and is never counted twice.
 */
function bogoDiscount(promo: CatalogPromotion, lines: PromoLine[]): number {
  const matching = promo.scope === "order" ? lines : lines.filter((l) => matches(promo, l));
  if (matching.length === 0) return 0;

  const buy = Math.max(1, Math.round(Number(promo.buy_qty ?? 1)));
  const get = Math.max(1, Math.round(Number(promo.get_qty ?? 1)));
  const pct = promo.get_discount_pct === null || promo.get_discount_pct === undefined
    ? 100
    : Number(promo.get_discount_pct);
  const groupSize = buy + get;

  const prices: number[] = [];
  for (const line of matching) {
    const whole = Math.floor(line.quantity);
    if (whole <= 0 || line.quantity <= 0) continue;

    const unit = line.lineTotal / line.quantity;
    for (let i = 0; i < whole; i += 1) prices.push(unit);
  }

  const freeUnits = Math.floor(prices.length / groupSize) * get;
  if (freeUnits <= 0) return 0;

  // Cheapest first — the standard "cheapest one free".
  prices.sort((a, b) => a - b);

  let discount = 0;
  for (let i = 0; i < freeUnits; i += 1) discount += prices[i];

  return round2(Math.max(0, (discount * pct) / 100));
}

/** What this promotion is worth on this cart. Zero when it does not apply. */
function discountFor(promo: CatalogPromotion, lines: PromoLine[], subtotal: number): number {
  if (promo.type === "bogo") return bogoDiscount(promo, lines);

  let base: number;

  if (promo.scope === "order") {
    if (promo.min_spend !== null && promo.min_spend !== undefined && subtotal < promo.min_spend) {
      return 0;
    }
    base = subtotal;
  } else {
    const matching = lines.filter((l) => matches(promo, l));
    if (matching.length === 0) return 0;

    const qty = matching.reduce((sum, l) => sum + l.quantity, 0);
    if (promo.min_qty !== null && promo.min_qty !== undefined && qty < promo.min_qty) {
      return 0;
    }
    base = matching.reduce((sum, l) => sum + l.lineTotal, 0);
  }

  if (base <= 0) return 0;

  let discount = promo.type === "percent" ? base * (promo.value / 100) : promo.value;

  if (promo.type === "percent" && promo.max_discount !== null && promo.max_discount !== undefined) {
    discount = Math.min(discount, promo.max_discount);
  }

  // Never discount more than the base the promotion applies to.
  return round2(Math.max(0, Math.min(discount, base)));
}

/**
 * The single best promotion, or null.
 *
 * Best means largest discount; a tie goes to the higher `priority`. Both
 * comparisons use the server's 0.001 tolerance rather than exact equality, so
 * two promotions worth the same money to the paisa cannot be ordered
 * differently by the two engines because of a floating-point tail.
 */
export function bestPromotion(
  promotions: CatalogPromotion[],
  lines: PromoLine[],
  subtotal: number,
  at: Date,
  timezone: string,
): PromoResult | null {
  let best: { promo: CatalogPromotion; discount: number } | null = null;

  for (const promo of promotions) {
    if (!liveNow(promo, at, timezone)) continue;

    const discount = discountFor(promo, lines, subtotal);
    if (discount <= 0) continue;

    if (best === null || discount > best.discount + 0.001) {
      best = { promo, discount };
    } else if (Math.abs(discount - best.discount) <= 0.001 && promo.priority > best.promo.priority) {
      best = { promo, discount };
    }
  }

  return best === null ? null : { id: best.promo.id, name: best.promo.name, discount: best.discount };
}

/**
 * Promotions this till holds but cannot evaluate.
 *
 * The safety net, and it matters more than the engine above. A promotion the
 * mirror does not understand is not a smaller discount — it is a receipt that
 * is wrong on every cart the promotion touches, discovered by a customer with
 * no way to check. So a shop holding one must not sell offline at all, and this
 * is what the check reads.
 *
 * Only LIVE ones count. A type nobody has switched on cannot mis-price
 * anything, and refusing a shop over a promotion that has been off since March
 * is a refusal with no risk behind it.
 */
export function unsupportedPromotions(
  promotions: CatalogPromotion[],
  at: Date,
  timezone: string,
): CatalogPromotion[] {
  return promotions.filter(
    (p) =>
      liveNow(p, at, timezone) &&
      !(SUPPORTED_TYPES as readonly string[]).includes(p.type),
  );
}
