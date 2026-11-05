/**
 * WHERE THIS BILL LEAVES THE CUSTOMER'S KHATA (2026-11-05, wholesale video).
 *
 * The tender sheet said only "Adds Rs 75,150 to Ali Kiryana Store's khata". A
 * wholesaler selling to a dealer on credit needs the other half before pressing
 * Complete: what the dealer already owes, what they will owe after this bill,
 * and how much of their limit is left — and, if this bill crosses the limit,
 * to be told now rather than refused at Complete. The lookup has always sent
 * `credit_balance` and `credit_limit`; the till never read them.
 *
 * Same rule as the server (Customer::chargeCredit): no limit set means no
 * limit; a limit of 0 means no credit at all; over is more than a paisa past it.
 */
export interface KhataOutlook {
  /** Owed before this bill. Negative = the customer is in credit (paid ahead). */
  owes: number;
  /** Owed once this bill is on the khata. */
  after: number;
  limit: number | null;
  /** Room left under the limit after this bill — null when there is no limit. */
  left: number | null;
  /** How far past the limit this bill would go — 0 when it fits. */
  over: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function khataOutlook(o: {
  balance: number | string | null | undefined;
  limit: number | string | null | undefined;
  adding: number;
}): KhataOutlook | null {
  if (o.balance === null || o.balance === undefined || o.balance === "") return null;

  const owes = round2(Number(o.balance));
  const after = round2(owes + o.adding);
  const limit = o.limit === null || o.limit === undefined || o.limit === "" ? null : round2(Number(o.limit));
  const over = limit !== null && after > limit + 0.001 ? round2(after - limit) : 0;

  return { owes, after, limit, left: limit === null ? null : round2(Math.max(0, limit - after)), over };
}
