import { formatEntryDate } from "../../../../components/ui/filters";

/** Recurring entries that have fallen due and not been posted. */
export interface Due {
  count: number;
  amount: number;
  /** The earliest due date among them, or null when there are none. */
  oldest: string | null;
}

/** What the server says the books are waiting on — see DashboardService::booksWaiting. */
export interface BooksWaiting {
  bills_due: Due;
  income_due: Due;
  over_budget: { count: number; over_by: number; categories: string[] };
}

export interface WaitingRow {
  key: "bills_due" | "income_due" | "over_budget";
  title: string;
  detail: string;
  /** Lands on the tab that deals with it, not on the page's first tab. */
  to: string;
}

/** "today" / "yesterday" / "1 Oct" — mid-sentence, so never capitalised. */
const when = (iso: string | null, today?: Date): string => {
  if (!iso) return "earlier";

  const said = formatEntryDate(iso, { today });

  return said === "Today" || said === "Yesterday" ? said.toLowerCase() : said;
};

/**
 * THE ROWS A BUSINESS'S BOOKS PUT ON ITS DASHBOARD.
 *
 * A recurring entry never posts itself — a person confirms the figure — and a
 * budget never blocks a bill. Both are deliberate, and both mean the product
 * is relying on somebody NOTICING. The only places that said so were a badge
 * on a tab of the Expenses screen and a sentence shown once to whoever typed
 * the bill that tipped a category over.
 *
 * For a shop that is one alert among many. For a business that only keeps
 * books it is every alert it will ever have, and its dashboard said "Nothing
 * needs you right now" with the rent ten days overdue.
 */
export function booksRows(
  books: BooksWaiting | null | undefined,
  money: (n: number) => string,
  today?: Date,
): WaitingRow[] {
  if (!books) return [];

  const rows: WaitingRow[] = [];
  const { bills_due: bills, income_due: income, over_budget: over } = books;

  if (bills.count > 0) {
    rows.push({
      key: "bills_due",
      title: `${bills.count.toLocaleString()} ${bills.count === 1 ? "bill has" : "bills have"} fallen due`,
      detail:
        bills.count === 1
          ? `${money(bills.amount)}, due ${when(bills.oldest, today)}. Confirm the real figure and post it.`
          : `${money(bills.amount)} in all, the oldest due ${when(bills.oldest, today)}. Confirm each figure and post it.`,
      to: "/tenant/expenses?tab=recurring",
    });
  }

  if (over.count > 0) {
    const named = over.categories.slice(0, 3);
    const more = over.count - named.length;

    rows.push({
      key: "over_budget",
      title: over.count === 1 && named[0] ? `${named[0]} is over its budget` : `${over.count.toLocaleString()} categories are over budget`,
      detail:
        over.count === 1
          ? `${money(over.over_by)} past the ceiling set for this month.`
          : `${named.join(", ")}${more > 0 ? ` and ${more} more` : ""} — ${money(over.over_by)} past their ceilings this month.`,
      to: "/tenant/expenses?tab=budgets",
    });
  }

  if (income.count > 0) {
    rows.push({
      key: "income_due",
      title: `${income.count.toLocaleString()} expected ${income.count === 1 ? "payment has" : "payments have"} fallen due`,
      detail:
        income.count === 1
          ? `${money(income.amount)}, expected ${when(income.oldest, today)}. Record it when it arrives.`
          : `${money(income.amount)} in all, the oldest expected ${when(income.oldest, today)}. Record each one when it arrives.`,
      to: "/tenant/income?tab=recurring",
    });
  }

  return rows;
}

/**
 * The same thing as ONE sentence, for the head of the page — or null when the
 * books are waiting on nothing.
 *
 * It has to be derived from the same figures as the rows. The head of the
 * page said "Nothing needs you right now" directly above a panel headed
 * "Attention needed · 1 to look at": two lists, each deciding for itself what
 * counts.
 */
export function booksSentence(books: BooksWaiting | null | undefined): { tone: "alert" | "busy"; text: string } | null {
  if (!books) return null;

  const { bills_due: bills, income_due: income, over_budget: over } = books;

  if (bills.count > 0) {
    return {
      tone: "alert",
      text: `${bills.count.toLocaleString()} ${bills.count === 1 ? "bill has fallen due and is" : "bills have fallen due and are"} waiting to be posted.`,
    };
  }

  if (over.count > 0) {
    return {
      tone: "busy",
      text:
        over.count === 1 && over.categories[0]
          ? `${over.categories[0]} has gone past its budget this month.`
          : `${over.count.toLocaleString()} categories have gone past their budgets this month.`,
    };
  }

  if (income.count > 0) {
    return {
      tone: "busy",
      text: `${income.count.toLocaleString()} expected ${income.count === 1 ? "payment has" : "payments have"} fallen due.`,
    };
  }

  return null;
}
