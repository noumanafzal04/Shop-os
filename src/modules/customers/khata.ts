import type { LedgerEntry } from "./services/customersService";

/**
 * A CUSTOMER'S KHATA, SAID THE WAY A SHOPKEEPER SAYS IT.
 *
 * `credit_balance` is one signed number: above zero the customer owes the
 * shop, below zero the shop holds the customer's money (an advance, used up
 * by their next credit sale). The card read it as "Rs −22.70 owed", which is
 * the arithmetic and not the sentence.
 */
export type Standing =
  | { kind: "owes"; amount: number }
  | { kind: "advance"; amount: number }
  | { kind: "clear"; amount: 0 };

export function standing(balance: string | number | null | undefined): Standing {
  const b = Math.round(Number(balance ?? 0) * 100) / 100;
  if (b > 0) return { kind: "owes", amount: b };
  if (b < 0) return { kind: "advance", amount: -b };

  return { kind: "clear", amount: 0 };
}

/**
 * HOW MUCH OF A PAYMENT IS MORE THAN IS OWED — asked BEFORE it is sent.
 *
 * The server refuses an overpayment unless it is told to keep the extra as an
 * advance, and says "Confirm to keep the extra…". The screen had no confirm, so
 * Rs 4,250 against Rs 4,227.30 owed could not be recorded at all (L13).
 * Null when the payment fits.
 */
export function overpaid(amount: number, balance: string | number | null | undefined): { owed: number; extra: number } | null {
  if (!(amount > 0)) return null;
  const owed = Math.max(0, Math.round(Number(balance ?? 0) * 100) / 100);
  const extra = Math.round((amount - owed) * 100) / 100;

  return extra > 0.004 ? { owed, extra } : null;
}

export const KHATA_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Transfer" },
  { value: "wallet", label: "Wallet" },
  { value: "other", label: "Other" },
] as const;

export type KhataMethod = (typeof KHATA_METHODS)[number]["value"];

/** A ledger method in people's words — "bank_transfer" was printed as it is stored. */
export const methodWords = (method: string | null | undefined): string =>
  KHATA_METHODS.find((m) => m.value === method)?.label ?? (method ? method.replace(/_/g, " ") : "");

/**
 * One statement line. A return and a cancellation are written to the ledger as
 * `payment`s (they take the debt down), and read as "Payment (return)" — they
 * are not money handed over, and the line now says what they are.
 */
export function ledgerLine(e: Pick<LedgerEntry, "type" | "method" | "reference">): string {
  if (e.type === "charge") return "Credit sale";
  if (e.type === "adjustment") return "Adjustment";
  if (e.method === "return") return `Returned${e.reference ? ` · ${e.reference}` : ""}`;
  if (e.method === "cancellation") return "Sale cancelled";

  return `Paid · ${methodWords(e.method)}`;
}

/** Where a sale is opened from anywhere else in the panel. */
export const saleLink = (sale: { id: string; invoice_number: string }): string =>
  `/tenant/sales?q=${encodeURIComponent(sale.invoice_number)}&open=${encodeURIComponent(sale.id)}`;

/** Where "near the limit" starts — the server's `Customer::NEAR_LIMIT`, which the filter uses. */
export const NEAR_LIMIT = 0.8;

/** How much of their credit limit a customer is using; null with no limit or no debt. */
export function limitUse(
  balance: string | number | null | undefined,
  limit: string | number | null | undefined,
): { share: number; state: "ok" | "near" | "over" } | null {
  const owed = Number(balance ?? 0);
  const cap = Number(limit ?? 0);
  if (!(owed > 0) || !(cap > 0)) return null;
  const share = owed / cap;

  return { share, state: share > 1 ? "over" : share >= NEAR_LIMIT ? "near" : "ok" };
}

/** A khata nobody has paid into for this long is the one to phone. */
export const QUIET_DAYS = 30;
