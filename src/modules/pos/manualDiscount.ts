/**
 * WHAT IS WRONG WITH A MANUAL DISCOUNT, BEFORE ANYBODY PAYS AGAINST IT.
 *
 * Past the bill (A-to-Z, B6): 5,000 off a 150 bill read "GRAND TOTAL 0".
 * Below nothing (#AZ19): −50 off a 150 bill ASKED Rs 200 — the till raised the
 * bill, let the cashier take the customer's money against it, and only the
 * server refused, in a field's words ("must be at least 0").
 *
 * Null when the discount can be given. The box says which, Done is held, and
 * the sale cannot be completed while it stands.
 */
export type DiscountRefusal = "below_nothing" | "past_the_bill";

export function manualDiscountRefusal(typed: string, subtotal: number): DiscountRefusal | null {
  const amount = Number(typed) || 0;
  if (amount < 0) return "below_nothing";
  if (subtotal > 0 && amount > subtotal) return "past_the_bill";

  return null;
}
