/**
 * WHAT AN ORDER WILL COST, BEFORE IT IS PLACED.
 *
 * The checkout showed the items and said "each shop adds its own delivery
 * charge… you pay on delivery". The shop's delivery fee, the least it will
 * deliver and the point at which delivery is free were all on the wire — and
 * the customer met them only afterwards: a total bigger than the basket, or a
 * refusal for an order below the minimum.
 *
 * This is the server's own arithmetic (`OrderService`), said in advance. The
 * server still decides — a coupon, a price that moved — but nobody should
 * learn the price of delivery from the bill.
 */
export interface ShopTerms {
  delivery_fee?: number | null;
  free_delivery_threshold?: number | null;
  min_order_amount?: number | null;
}

export type Fulfillment = "delivery" | "pickup";

export interface OrderFigures {
  /** What delivery adds. Nought when collected, or when the basket earned it free. */
  delivery: number;
  /** The basket and the delivery, before any coupon. */
  total: number;
  /** How far the basket is below the shop's minimum for DELIVERY. Nought when it is not. */
  short: number;
  /** How much more would make delivery free, while it is not. Null when it never is, or already is. */
  toFreeDelivery: number | null;
}

const money = (n: number) => Math.round(n * 100) / 100;

export function orderFigures(subtotal: number, how: Fulfillment, terms: ShopTerms): OrderFigures {
  const fee = Number(terms.delivery_fee ?? 0);
  const freeAbove = terms.free_delivery_threshold ?? null;
  const minimum = terms.min_order_amount ?? null;

  // A minimum is a rule for having it brought. Collecting it has none.
  const short = how === "delivery" && minimum !== null && subtotal < minimum ? money(minimum - subtotal) : 0;
  const earnedFree = freeAbove !== null && subtotal >= freeAbove;
  const delivery = how === "delivery" && !earnedFree ? fee : 0;
  const toFreeDelivery = how === "delivery" && fee > 0 && freeAbove !== null && !earnedFree ? money(freeAbove - subtotal) : null;

  return { delivery, total: money(subtotal + delivery), short, toFreeDelivery };
}
