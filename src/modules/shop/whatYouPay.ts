/**
 * WHAT THIS SHOP PAYS — its plan, and what was added for it.
 *
 * The Subscription screen said "Rs 3,000 every month" to a shop that is asked
 * for Rs 3,400. The plan's price is one line of the bill; a module switched
 * on past the plan is another, and that one was on the admin's page and
 * nowhere a shop could see it. The one screen where an owner reads what they
 * are charged named a smaller figure than the one on the phone.
 *
 * Said only when there is something to add up. A shop with exactly what its
 * plan includes pays the plan's price, and the screen already says that.
 */
export interface ShopBill {
  /** How many months one payment covers. */
  months: number;
  plan: number;
  addons: Array<{ key: string; label: string; monthly: number; amount: number }>;
  total: number;
}

export interface WhatYouPay {
  /** "every month", "every 12 months". */
  every: string;
  plan: string;
  lines: Array<{ key: string; label: string; amount: string; note: string | null }>;
  total: string;
}

export const everyPeriod = (months: number): string => (months === 1 ? "every month" : `every ${months} months`);

export function whatYouPay(bill: ShopBill | null | undefined, money: (n: number) => string): WhatYouPay | null {
  if (!bill || bill.addons.length === 0) return null;

  return {
    every: everyPeriod(bill.months),
    plan: money(bill.plan),
    lines: bill.addons.map((addon) => ({
      key: addon.key,
      label: addon.label,
      // Given at no charge is said, not left off: it was added for this shop
      // and the shop should be able to see that it has it.
      amount: addon.monthly > 0 ? money(addon.amount) : "No charge",
      // By the year, an add-on is twelve of its monthly price — say which.
      note: addon.monthly > 0 && bill.months > 1 ? `${money(addon.monthly)} a month` : null,
    })),
    total: money(bill.total),
  };
}
