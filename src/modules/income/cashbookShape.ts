import type { KindOfBusiness } from "../../common/tenant/kindOfBusiness";

/** A money column of the cashbook's day table — a key of each day's row. */
export type CashbookColumn = {
  key: "sales_revenue" | "other_income" | "expenses" | "refunds";
  label: string;
};

export interface CashbookShape {
  /** What the page is, in the reader's terms. */
  says: string;
  /** The caution under it — or nothing, when there is nothing to be cautious about. */
  footnote: string | null;
  /** The money columns between Date and Net. */
  columns: CashbookColumn[];
  /** Whether "Money in" and "Money out" are each made of two things worth naming. */
  splits: boolean;
}

/**
 * WHAT THE CASHBOOK LOOKS LIKE FOR THIS BUSINESS.
 *
 * One rule, the same one the Reports tabs and the dashboard follow: do not
 * draw what the business can never fill.
 *
 *   A shop that sells     Sales · Other income · Expenses · Refunds
 *                         — its sales are derived, and a refund is a sale
 *                         given back
 *
 *   A books-only business Income · Expenses
 *                         — there is no sale to derive and none to give back.
 *                         "Other income" is called Income, because for this
 *                         business it is not the OTHER anything: it is all of
 *                         what it takes.
 *
 * The footnote about the cash drawer is only true of a business with one. An
 * online shop sells with no till; telling it to "use the POS shift close" for
 * its cash sends it to a screen it does not have.
 */
export function cashbookShape(kind: Pick<KindOfBusiness, "sells" | "hasTill">): CashbookShape {
  if (!kind.sells) {
    return {
      says: "Everything in and out, day by day — the income you recorded against the expenses you recorded.",
      footnote: null,
      columns: [
        { key: "other_income", label: "Income" },
        { key: "expenses", label: "Expenses" },
      ],
      splits: false,
    };
  }

  return {
    says:
      "Everything in and out — sales and other income against expenses and refunds. Sales are counted automatically; you don't enter them here.",
    footnote: kind.hasTill
      ? "This is money booked across all payment types (cash, card, credit) — not the cash drawer. For physical cash at the counter, use the POS shift close."
      : "This is money booked across all payment types (cash, card, credit), on the day it was taken.",
    columns: [
      { key: "sales_revenue", label: "Sales" },
      { key: "other_income", label: "Other income" },
      { key: "expenses", label: "Expenses" },
      { key: "refunds", label: "Refunds" },
    ],
    splits: true,
  };
}
