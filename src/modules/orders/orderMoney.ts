/**
 * WHAT AN ORDER'S MONEY IS MADE OF — said line by line, as the server made it.
 *
 * An order is priced by the till's rules now (2026-11-11): the shop's tax,
 * its best live promotion and a member's discount, beside the coupon and the
 * delivery. Every screen that shows an order — the checkout, Take order, the
 * shop's order sheet, "My orders" — says the same lines from the same
 * figures, and adds NOTHING up itself: every amount here is one the server
 * sent. The coupon's share is the one figure derived, and only by taking the
 * other two shares out of the server's `discount` — an order from before
 * offers reached orders has neither, so its whole discount is the coupon's,
 * which is what it always was.
 */
export interface OrderMoney {
  subtotal: number | string;
  discount?: number | string | null;
  coupon_code?: string | null;
  promotion_name?: string | null;
  promotion_discount?: number | string | null;
  member_discount?: number | string | null;
  tax?: number | string | null;
  tax_inclusive?: boolean | null;
  delivery_fee?: number | string | null;
  total: number | string;
}

export type MoneyLineKind = "goods" | "off" | "tax" | "tax-inside" | "delivery" | "total";

export interface MoneyLine {
  key: string;
  label: string;
  amount: number;
  kind: MoneyLineKind;
}

const n = (v: number | string | null | undefined): number => {
  const x = Number(v ?? 0);

  return Number.isFinite(x) ? x : 0;
};

const cents = (x: number): number => Math.round(x * 100) / 100;

/**
 * @param fulfillment  A pickup has no delivery line at all; a delivery shows
 *                     its fee, or "free" as a nought. Unknown → shown only
 *                     when there is a fee.
 */
export function orderMoneyLines(m: OrderMoney, fulfillment?: "delivery" | "pickup"): MoneyLine[] {
  const promotion = n(m.promotion_discount);
  const member = n(m.member_discount);
  const coupon = cents(n(m.discount) - promotion - member);
  const tax = n(m.tax);
  const fee = n(m.delivery_fee);

  const lines: MoneyLine[] = [{ key: "goods", label: "Items", amount: n(m.subtotal), kind: "goods" }];

  if (coupon > 0) {
    lines.push({ key: "coupon", label: m.coupon_code ? `Coupon ${m.coupon_code}` : "Coupon", amount: coupon, kind: "off" });
  }
  if (promotion > 0) {
    lines.push({ key: "promotion", label: m.promotion_name || "Offer", amount: promotion, kind: "off" });
  }
  if (member > 0) {
    lines.push({ key: "member", label: "Member discount", amount: member, kind: "off" });
  }
  if (tax > 0) {
    lines.push(m.tax_inclusive
      ? { key: "tax", label: "Tax (included in the prices)", amount: tax, kind: "tax-inside" }
      : { key: "tax", label: "Tax", amount: tax, kind: "tax" });
  }
  if (fulfillment === "delivery" || (fulfillment === undefined && fee > 0)) {
    lines.push({ key: "delivery", label: "Delivery", amount: fee, kind: "delivery" });
  }

  lines.push({ key: "total", label: "Total", amount: n(m.total), kind: "total" });

  return lines;
}

/** How a line's amount reads: money off with a minus, a free delivery as "Free". */
export function moneyLineValue(line: MoneyLine, format: (amount: number) => string): string {
  if (line.kind === "off") return `− ${format(line.amount)}`;
  if (line.kind === "delivery" && line.amount === 0) return "Free";

  return format(line.amount);
}
