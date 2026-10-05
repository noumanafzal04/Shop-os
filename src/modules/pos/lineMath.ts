import type { ProductUnit } from "../catalog/types";
import { round2 } from "../offline/pricing/money";

/**
 * WHAT A CART LINE IS WORTH — the counter screen's arithmetic, in one place.
 *
 * ── Why this left `PosPage` ──────────────────────────────────────────
 *
 * These six functions were module-level constants inside a 4,700-line
 * component, so nothing could call them but the component. They were never
 * tested, because testing them meant rendering a till — a shift, a catalog,
 * an outbox, a scanner — to ask what 0.275 × 1,235 is.
 *
 * And they were wrong, quietly, in the one way that matters at a counter:
 *
 *     two weighed lines of 0.275 kg at Rs 1,235/kg
 *
 *       the server       339.63 + 339.63          = 679.26
 *       this screen      339.625 + 339.625 → round = 679.25
 *
 * One paisa. The server rounds a line when it prices it; this added the raw
 * figures and rounded once at the end. A cash tender never notices. A CARD
 * tender has no change to absorb it, so the sale is refused for being 0.01
 * short — the tax-group failure at a hundredth of the size, on every shop
 * that sells by weight.
 *
 * ── The order of operations is the server's ──────────────────────────
 *
 * `CreateSaleAction` rounds the unit price, then the gross, then the line
 * total, and accumulates the subtotal rounding at every addition. This
 * follows it step for step, with `round2` — PHP's rounding, not
 * `Math.round(x * 100) / 100`, which disagrees with it on 1.005, 1.015 and
 * 0.145. `lineMath.test.ts` holds every function here to the pricing engine,
 * which golden fixtures hold to the real endpoint.
 */

/** The fields this arithmetic reads. `PosPage`'s cart line carries many more. */
export interface LineForMath {
  unit_price: number;
  quantity: number;
  base_price?: number;
  wholesale_price?: number | null;
  price_level?: "retail" | "wholesale";
  price_tiers?: Array<{ min_qty: number | string; price: number | string }> | null;
  product_unit_id?: string | null;
  units?: ProductUnit[];
  discountValue?: number;
  discountMode?: "pct" | "amt" | string;
  /** The MONEY the line named — "do hazaar ka daal do". Then it IS the gross. */
  amountAsked?: number;
}

/** Price for one of a pack: explicit pack price, else base price × factor. */
export const packPrice = (basePrice: number, u: ProductUnit): number =>
  u.price != null && u.price !== "" ? Number(u.price) : round2(basePrice * Number(u.factor));

/** The retail-or-wholesale per-base-unit rate for a line (mirrors the server). */
export const levelBase = (l: LineForMath): number => {
  const retail = l.base_price ?? l.unit_price;
  const w = l.wholesale_price;

  return l.price_level === "wholesale" && w != null && Number(w) > 0 ? Math.min(Number(w), retail) : retail;
};

/** Recompute a line's display unit_price from its level + selected pack. */
export const recalcLine = <T extends LineForMath>(l: T, patch: Partial<T>): T => {
  const next = { ...l, ...patch };
  const base = levelBase(next);
  const u = next.product_unit_id ? next.units?.find((x) => x.id === next.product_unit_id) : undefined;
  next.unit_price = u ? packPrice(base, u) : base;

  return next;
};

/**
 * The per-unit price a line is charged at — `Product::priceForLevel`, mirrored.
 *
 * ── Two rules this used to get wrong ─────────────────────────────────
 *
 * It took the DEEPEST quantity tier the line had reached and stopped there.
 * The server takes the CHEAPEST tier the quantity qualifies for, and never
 * lets that exceed the selling price:
 *
 *   a tier above a flash sale   Tier "10+ at Rs 90", item on sale at Rs 80.
 *                               The server charges 80. This charged 90 — the
 *                               screen asked the customer for MORE than the
 *                               sale recorded, and the difference went into
 *                               the drawer as money nobody could explain.
 *   wholesale under a tier      Wholesale Rs 95, tier "50+ at Rs 85", fifty
 *                               bought. The server charges 85 (`min` of the
 *                               two). This returned the flat wholesale 95.
 *
 * Both are overcharges on screen, so neither was ever REFUSED — the server
 * was simply handed too much and called the rest "change". That is why they
 * never showed up as a failed sale and would not have, however long anybody
 * waited.
 *
 * A PACK is priced explicitly — its own price, or base × factor — and tiers
 * do not apply to it. That half is unchanged.
 */
export const lineUnit = (l: LineForMath): number => {
  if (l.product_unit_id) return l.unit_price;

  const w = l.wholesale_price;
  const wholesale = l.price_level === "wholesale" && w != null && Number(w) > 0;

  /**
   * WHAT ONE COSTS AT RETAIL, and the two fields do not mean the same thing.
   *
   * `unit_price` is the line's own per-unit price: the product's, or the
   * SIZE's when one was chosen, or the dish's with its extras. `base_price`
   * is the PARENT product's selling price, kept so a line switched to
   * wholesale can find its way back.
   *
   * So a retail line reads `unit_price` — reading `base_price` here would
   * charge a Large at the price of the product it is a size of, which is the
   * mistake this function's first rewrite made and a sized-item test caught.
   * Only a WHOLESALE line reads `base_price`, because switching the level
   * has overwritten its `unit_price` with the wholesale figure.
   */
  const selling = wholesale ? (l.base_price ?? l.unit_price) : l.unit_price;

  let best: number | null = null;
  for (const t of l.price_tiers ?? []) {
    const min = Number(t.min_qty);
    const price = Number(t.price);
    if (min > 0 && price > 0 && l.quantity >= min && (best === null || price < best)) {
      best = price;
    }
  }

  const retail = best !== null ? Math.min(best, selling) : selling;

  return wholesale ? Math.min(Number(w), retail) : retail;
};

/**
 * Gross line value before any per-line discount.
 *
 * For a line that named money, that IS the money — not `unit × quantity`
 * recomputed from it. Rs 2,000 at 268.50/L is 7.449 litres, and 7.449 × 268.50
 * is Rs 2,000.06: six paisa the customer never handed over.
 *
 * ROUNDED, twice, in the server's order: the unit price first, then the
 * product. Rounding only the product gives a different paisa whenever the
 * unit price itself carries a third decimal — a modifier delta, a pack
 * factor.
 */
export const lineGross = (l: LineForMath): number =>
  l.amountAsked !== undefined ? round2(l.amountAsked) : round2(round2(lineUnit(l)) * l.quantity);

/** Per-line discount amount (clamped to the line), mirroring the server. */
export const lineDiscountAmt = (l: LineForMath): number => {
  const v = l.discountValue ?? 0;
  if (v <= 0) return 0;

  const gross = lineGross(l);

  return l.discountMode === "pct" ? round2((gross * Math.min(v, 100)) / 100) : Math.min(round2(v), gross);
};

/** Line value the customer pays after its per-line discount. */
export const lineNet = (l: LineForMath): number => Math.max(0, round2(lineGross(l) - lineDiscountAmt(l)));

/**
 * The cart's subtotal, rounded AT EVERY ADDITION.
 *
 * Not `lines.reduce((s, l) => s + lineNet(l), 0)`. With every line already
 * rounded the two usually agree — and then float addition does what it does:
 * 0.1 + 0.2 is 0.30000000000000004, and a long cart of ordinary prices lands
 * a hair under a figure that then rounds the wrong way. The server rounds as
 * it goes, so this does.
 */
export const cartSubtotal = (lines: readonly LineForMath[]): number =>
  lines.reduce((sum, l) => round2(sum + lineNet(l)), 0);
