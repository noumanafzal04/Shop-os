import { effectiveTaxRate, taxOnLines } from "../offline/pricing/priceCart";
import { round2 } from "../offline/pricing/money";
import { cartSubtotal, lineNet, recalcLine, type LineForMath } from "./lineMath";

/**
 * THE WHOLE BILL, made the way the server makes it.
 *
 * `lineMath` is the lines and `taxOnLines` is the tax. Between them and the
 * amount a cashier reads out sit five more things the sale does to a bill, and
 * the counter screen did three of them wrong:
 *
 *     a customer's group    its percentage was never taken off, and its price
 *                           level never applied. A member was shown the full
 *                           retail figure — refused on a card ("no change to
 *                           give"), and on cash recorded at a lower figure
 *                           than anybody at the counter saw.
 *     cash beside goods     rounded to the coin on screen. A trade-in makes the
 *                           sale two tenders, and two tenders settle exactly.
 *     a split of cash       NOT rounded on screen, where the server rounds any
 *                           sale whose every tender is cash.
 *
 * So the order of operations is the server's, step for step, and this file is
 * held to it by `fixtures/till-bill.json` — bills rung through the real
 * endpoint, the same arrangement the offline engine has. See
 * `TillBillFixturesTest` on the server for how they are made.
 */

export type PriceLevel = "retail" | "wholesale";

/** What a customer's group does to a bill. Two things, and only these. */
export interface BillGroup {
  price_level: PriceLevel;
  discount_percent: number;
}

export type BillLine = LineForMath & { tax_rate?: number | null; tax_group_rate?: number | null };

/**
 * A line at the level it will be CHARGED at.
 *
 * `price_level` on a line is what the CASHIER chose. Left unset, it follows
 * the customer — which is the server's rule word for word: "set by the
 * customer group, overridden per line". A line the cashier put back to retail
 * stays retail for a trade customer, because they said so.
 */
export const followLevel = <T extends LineForMath>(line: T, group: BillGroup | null): T =>
  line.price_level !== undefined || group?.price_level !== "wholesale"
    ? line
    : recalcLine(line, { price_level: "wholesale" } as Partial<T>);

/** The coins a shop may say it settles to. Anything else settles exactly. */
export const CASH_INCREMENTS = [0, 1, 5, 10] as const;

/**
 * A cash bill in coins that exist — `CashRounding::apply`.
 *
 * Nearest step, and a tie goes DOWN, in the customer's favour.
 */
export function settleInCoins(due: number, step: number): number {
  if (step <= 0 || !(CASH_INCREMENTS as readonly number[]).includes(step)) return round2(due);

  const units = due / step;
  const floor = Math.floor(units);

  return round2((units - floor > 0.5 ? floor + 1 : floor) * step);
}

export interface BillInput {
  lines: readonly BillLine[];
  group: BillGroup | null;
  defaultTaxRate: number;
  taxInclusive: boolean;
  /** The cashier's own figure off the bill. */
  discount: number;
  couponDiscount?: number;
  promoDiscount?: number;
  redeemPoints?: number;
  redeemValue?: number;
  /** What the goods on the counter settle. A tender, not a discount. */
  tradeIn?: number;
  /** Every way money is arriving: `["cash"]`, `["cash", "card"]` for a split. */
  tenders: readonly string[];
  cashRounding: number;
}

export interface Bill {
  /** The lines at the level each is charged at. Draw THESE, not the cart. */
  lines: BillLine[];
  subtotal: number;
  groupDiscount: number;
  loyaltyDiscount: number;
  /** Everything off the bill, the way the sale records it. */
  discount: number;
  taxableBase: number;
  tax: number;
  total: number;
  /** The coin adjustment on a cash-only bill. */
  rounding: number;
  /**
   * What the customer hands over: the bill, settled to the coin, less what
   * the goods on the counter settle. The bank's share is NOT off it — that is
   * quoted beside it, and the card slice is sent before it.
   *
   * The same figure the server states as `payable`.
   */
  payable: number;
}

export function tillBill(input: BillInput): Bill {
  const lines = input.lines.map((l) => followLevel(l, input.group));
  const subtotal = cartSubtotal(lines);

  // ── Off the bill, in the order the sale takes it ───────────────────
  let discount = round2(input.discount);

  const coupon = input.couponDiscount ?? 0;
  if (coupon > 0) discount = round2(Math.min(discount + coupon, subtotal));

  // Never more than what the discounts before it left.
  const promo = round2(Math.min(input.promoDiscount ?? 0, round2(subtotal - discount)));
  if (promo > 0) discount = round2(discount + promo);

  // On what is still owed after all of the above — so it can never push the
  // bill below nothing, however generous the group.
  const pct = Math.min(input.group?.discount_percent ?? 0, 100);
  const groupDiscount = pct > 0 ? round2((Math.max(0, round2(subtotal - discount)) * pct) / 100) : 0;
  if (groupDiscount > 0) discount = round2(discount + groupDiscount);

  // Last, so points never pay for what a discount already did.
  const points = input.redeemPoints ?? 0;
  const loyaltyDiscount = points > 0 ? round2(points * (input.redeemValue ?? 1)) : 0;
  if (loyaltyDiscount > 0) discount = round2(discount + loyaltyDiscount);

  // ── Tax, on what is actually being paid ────────────────────────────
  //
  // Unrounded, because the server leaves it unrounded. No fixture tells the
  // two apart — a difference would need a share landing on a half-paisa to
  // within a float's error — so this is agreement by copying, not by proof.
  const taxableBase = Math.max(0, subtotal - discount);
  const tax = taxOnLines(
    lines.map((l) => ({ line_total: lineNet(l), tax_rate: effectiveTaxRate(l, input.defaultTaxRate) })),
    subtotal,
    taxableBase,
    input.taxInclusive,
  );

  const total = Math.max(0, input.taxInclusive ? round2(subtotal - discount) : round2(subtotal - discount + tax));

  // ── What crosses the counter ───────────────────────────────────────
  //
  // Rounded only when EVERY tender is cash. Goods on the counter are a tender,
  // so a battery traded in makes the rest settle exactly.
  const tradeIn = input.tradeIn ?? 0;
  const methods = [...new Set(input.tenders.filter(Boolean))];
  const cashOnly = tradeIn <= 0 && methods.length === 1 && methods[0] === "cash";
  const rounding = cashOnly ? round2(settleInCoins(total, input.cashRounding) - total) : 0;

  return {
    lines,
    subtotal,
    groupDiscount,
    loyaltyDiscount,
    discount,
    taxableBase: round2(taxableBase),
    tax,
    total,
    rounding,
    payable: Math.max(0, round2(total + rounding - tradeIn)),
  };
}
