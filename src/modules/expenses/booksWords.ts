import type { KindOfBusiness } from "../../common/tenant/kindOfBusiness";

/**
 * THE WORDS ON THE MONEY SCREENS THAT DEPEND ON WHO IS READING THEM.
 *
 * Expenses and Income were written for a shop with a till, and said so in
 * six places a books-only business reads every day:
 *
 *   "Every bill the shop has paid… if it was cash — your drawer"
 *   "Cash (from till)" / "Cash (to till)"   as the name of a payment method
 *   "Cash comes out of your open drawer, so the shift's expected cash drops"
 *   "Money in that isn't a sale… Your sales revenue is counted automatically"
 *
 * None of them is true of a business that has no till and makes no sale, and
 * the last is the worst: it tells a consultancy that the screen where it
 * records every fee it earns is for the money that is NOT its income.
 *
 * Two questions decide every one of these — does it have a till, and does it
 * sell — so they are answered here, from `KindOfBusiness`, and the pages only
 * print what comes back.
 */
export interface BooksWords {
  /** Under the Expenses heading. */
  expenses: string;
  /** Under the Income heading. */
  income: string;
  /** On the income Categories tab. */
  incomeCategories: string;
  /** When there is no income yet. */
  noIncomeYet: string;
  /** What "cash" is called in the Paid by list. */
  cashPaid: string;
  /** What "cash" is called in the Received by list. */
  cashReceived: string;
  /** Under the expense form when Paid by is cash — or nothing to say. */
  cashPaidHint: string | null;
  /** Under the income form when Received by is cash — or nothing to say. */
  cashReceivedHint: string | null;
  /** The example in the Description box of an expense. */
  rentExample: string;
  /** The example in the Description box of an income entry. */
  incomeExample: string;
}

type Kind = Pick<KindOfBusiness, "sells" | "hasTill" | "noun">;

export function booksWords(kind: Kind): BooksWords {
  const where = kind.noun === "shop" ? "shop" : "office";

  return {
    expenses: kind.hasTill
      ? "Every bill the shop has paid. File one and it lands in your reports, your profit and — if it was cash — your drawer."
      : `Every bill the ${kind.noun} has paid. File one and it lands in your cashbook, your ledger and your reports.`,

    income: kind.sells
      ? "Money in that isn't a sale — rent received, an owner putting money in, a refund from a supplier. Your sales revenue is counted automatically in the Cashbook."
      : "Everything the business takes in — a client's payment, a fee, a grant, money the owner put in. File it here and it lands in your cashbook, your ledger and your reports.",

    incomeCategories: kind.sells
      ? "Where money in that isn't a sale gets filed. Yours to change — one with entries under it is turned off rather than deleted."
      : "What your money in is filed under. Yours to change — one with entries under it is turned off rather than deleted.",

    noIncomeYet: kind.sells
      ? "Money in that isn't a sale — rent received, an owner putting money in, a refund from a supplier."
      : "A client's payment, a fee, a grant, money the owner put in — record it here.",

    cashPaid: kind.hasTill ? "Cash (from till)" : "Cash",
    cashReceived: kind.hasTill ? "Cash (to till)" : "Cash",

    cashPaidHint: kind.hasTill
      ? "Cash comes out of your open drawer, so the shift's expected cash drops by this amount."
      : null,
    cashReceivedHint: kind.hasTill
      ? "Cash goes into your open drawer, so the shift's expected cash rises by this amount."
      : null,

    rentExample: `e.g. July ${where} rent`,
    // What this business would actually type there: for a shop, the odd
    // rupee that was not a sale; for an office, the invoice a client paid.
    incomeExample: kind.sells ? "e.g. Owner cash injection" : "e.g. Invoice 114 — client payment",
  };
}

/** A payment-method list with `cash` called what this business calls it. */
export function withCashCalled<T extends { value: string; label: string }>(
  methods: readonly T[],
  cash: string,
): Array<{ value: string; label: string }> {
  return methods.map((m) => ({ value: m.value, label: m.value === "cash" ? cash : m.label }));
}
