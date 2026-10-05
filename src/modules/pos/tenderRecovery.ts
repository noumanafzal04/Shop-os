import { ApiError } from "../../common/types/api";

/**
 * WHAT THE SERVER SAYS THE BILL IS, when it refused a tender for being short.
 *
 * ── The dead end this removes ────────────────────────────────────────
 *
 *     Amount due   Rs 12,610
 *     Sale failed  Amount paid (12,610.00) is less than the total (14,023.94).
 *     [ Cancel ]   [ Complete sale · Rs 12,610 ]
 *
 * A cashier with a customer in front of them, a button that will be refused
 * every time it is pressed, and the right number sitting in a sentence the
 * screen could not use. The only way out was to abandon the sale.
 *
 * The till prices a cart itself so it can show a figure before anything is
 * sent. That is a MIRROR of the server, and a mirror can be wrong — it was,
 * here, by exactly the tax a tax group charges. That specific cause is fixed
 * at its source. This is the other half: for the next way the two disagree,
 * the till stops arguing and shows the server's figure.
 *
 * ── It only ever raises a question, never charges on its own ─────────
 *
 * Returning a number does not complete anything. The screen puts it where
 * the amount due is drawn and the cashier presses the button AGAIN, having
 * seen the new figure. A till that silently retried at a higher price would
 * be taking money nobody agreed to.
 *
 * ── Three refusals carry it, and they are one fault ──────────────────
 *
 *   PAYMENT_INSUFFICIENT  the till's figure was too LOW (a tax group).
 *   CHANGE_WITHOUT_CASH   too HIGH, on a card: "no change to give" (a member's
 *                         discount the till had never heard of).
 *   BILL_MISMATCH         either way — the till said what it showed and the
 *                         server will not make a sale at any other figure.
 *
 * ── The figure is `payable`, never `amount_due` ──────────────────────
 *
 * `amount_due` is what every tender together must cover AFTER the bank's
 * help. A till holds a different figure: what the customer hands over, with
 * the goods on the counter already off it and the bank's share still on. The
 * first version of this read `amount_due`, and so a trade-in sale asked for the
 * whole bill again, and a bank-offer sale sent the reduced figure back as the
 * card slice, had the offer taken off it a second time, and was refused for
 * ever. The server now names the till's figure for what it is.
 *
 * Null for every other refusal — out of stock, no open shift, a credit limit
 * — because none of those is about the amount, and showing a "corrected
 * total" for them would be inventing one.
 */
export const BILL_REFUSALS = ["PAYMENT_INSUFFICIENT", "CHANGE_WITHOUT_CASH", "BILL_MISMATCH"] as const;

export function serverDueFrom(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  if (!(BILL_REFUSALS as readonly (string | undefined)[]).includes(error.errorCode)) return null;

  const payable = error.figure("payable");

  // Zero IS a bill — a member whose group takes it all. Negative is not.
  return payable !== null && payable >= 0 ? payable : null;
}

/**
 * Everything that DEFINES the bill, as one comparable string.
 *
 * A corrected figure is true of the cart it was given for and of nothing
 * else. The moment a line, a discount, the tender or the customer changes,
 * the server would answer differently — so the correction is dropped and the
 * till goes back to its own arithmetic until the server says otherwise again.
 *
 * Without this the screen would carry Rs 14,023.94 onto a cart that has since
 * had a line removed, which is a wrong number with the server's name on it.
 */
export function billKey(parts: {
  lines: ReadonlyArray<{
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    unit_price: number;
    discountValue?: number | string | null;
    discountMode?: string | null;
    product_unit_id?: string | null;
    modifier_option_ids?: readonly string[] | null;
  }>;
  discount: number;
  couponDiscount: number;
  promoDiscount: number;
  redeemPoints: number;
  method: string;
  splitMethods: readonly string[];
  tradeInTotal: number;
  bankId: string | null;
  customerPhone: string;
}): string {
  return JSON.stringify([
    parts.lines.map((l) => [
      l.product_id,
      l.variant_id ?? null,
      l.quantity,
      l.unit_price,
      l.discountValue ?? null,
      l.discountMode ?? null,
      l.product_unit_id ?? null,
      l.modifier_option_ids ?? [],
    ]),
    parts.discount,
    parts.couponDiscount,
    parts.promoDiscount,
    parts.redeemPoints,
    parts.method,
    parts.splitMethods,
    parts.tradeInTotal,
    parts.bankId,
    parts.customerPhone.trim(),
  ]);
}
