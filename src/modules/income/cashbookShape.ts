import type { KindOfBusiness } from "../../common/tenant/kindOfBusiness";

/** A money column of the cashbook's day table — a key of each day's row. */
export type CashbookColumn = {
  key: "sales_revenue" | "other_income" | "cash_rounding" | "expenses" | "refunds" | "supplier_payments";
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

/** The period's totals the two extra columns are decided from. */
export type CashbookTotals = {
  sales_revenue: number;
  other_income: number;
  cash_rounding?: number;
  expenses: number;
  refunds: number;
  supplier_payments?: number;
};

/**
 * THE COLUMNS FOR THIS PERIOD (the full re-test, 2026-10-18).
 *
 * Money in and Money out counted two things the table never showed:
 *   #1  paying a supplier — Money out read 800 over a row of dashes;
 *   #2  the rounding on a cash bill — 120 in the drawer, 116.99 in the book.
 * Each gets its column when the period has any, so the columns always add up
 * to the Net beside them — and a shop that never rounds or never buys through
 * the system is not shown a column of dashes.
 */
export function cashbookColumns(shape: CashbookShape, totals: CashbookTotals | undefined): CashbookColumn[] {
  const columns: CashbookColumn[] = [];
  for (const column of shape.columns) {
    columns.push(column);
    if (column.key === "other_income" && (totals?.cash_rounding ?? 0) !== 0) {
      columns.push({ key: "cash_rounding", label: "Cash rounding" });
    }
  }
  if ((totals?.supplier_payments ?? 0) !== 0) columns.push({ key: "supplier_payments", label: "Suppliers paid" });

  return columns;
}

/** What Money in and Money out are each made of — every part, so they add up. */
export function cashbookSplits(totals: CashbookTotals | undefined, money: (n: number) => string): { in: string; out: string } {
  const part = (label: string, n: number | undefined, always = false): string | null =>
    always || (n ?? 0) !== 0 ? `${label} ${money(n ?? 0)}` : null;
  const join = (parts: Array<string | null>): string => parts.filter((p): p is string => p !== null).join(" · ");

  return {
    in: join([part("Sales", totals?.sales_revenue, true), part("Other", totals?.other_income, true), part("Rounding", totals?.cash_rounding)]),
    out: join([part("Expenses", totals?.expenses, true), part("Refunds", totals?.refunds, true), part("Suppliers", totals?.supplier_payments)]),
  };
}
