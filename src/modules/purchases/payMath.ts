/**
 * WHAT IS LEFT AFTER THIS PAYMENT.
 *
 * The Pay dialog used to show one number — the outstanding balance — and then
 * take an amount without ever saying what the amount would leave behind. A
 * shopkeeper handing over Rs 15,000 against Rs 36,000 wants to see Rs 21,000
 * before they press the button, not after.
 *
 * Kept out of the component so the arithmetic can be tested on its own, and so
 * the dialog and anything that later shows the same line cannot drift apart.
 */

/** Rupee-level tolerance. Below this, a difference is rounding, not money. */
const EPSILON = 0.001;

export type PayKind = "still-owed" | "settles" | "advance";

export interface PayOutlook {
  /** What is still owed after this payment (0 when it settles or overshoots). */
  remaining: number;
  /** Money paid beyond what was owed — the shop is owed it back in goods. */
  advance: number;
  kind: PayKind;
}

/**
 * @param due     what the payment is being applied to — one order's balance,
 *                or the whole account.
 * @param amount  what is being paid.
 */
export function payOutlook(due: number, amount: number): PayOutlook {
  const after = round(due - amount);

  if (after > EPSILON) return { remaining: after, advance: 0, kind: "still-owed" };
  if (after < -EPSILON) return { remaining: 0, advance: round(-after), kind: "advance" };

  return { remaining: 0, advance: 0, kind: "settles" };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
