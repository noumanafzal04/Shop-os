import { describe, expect, it } from "vitest";

import { booksRows, booksSentence, type BooksWaiting } from "./booksWaiting";

const money = (n: number) => `Rs ${n.toLocaleString()}`;
const TODAY = new Date(2026, 9, 10); // 10 Oct 2026

const none = { count: 0, amount: 0, oldest: null };
const quiet: BooksWaiting = { bills_due: none, income_due: none, over_budget: { count: 0, over_by: 0, categories: [] } };
const waiting = (over: Partial<BooksWaiting>): BooksWaiting => ({ ...quiet, ...over });

describe("the rows a business's books put on its dashboard", () => {
  it("nothing waiting is no row — and no books block is no row either", () => {
    expect(booksRows(quiet, money, TODAY)).toEqual([]);
    expect(booksRows(null, money, TODAY)).toEqual([]);
    expect(booksRows(undefined, money, TODAY)).toEqual([]);
  });

  it("one bill, with what it is and when it was due, leading to the tab that posts it", () => {
    const [row] = booksRows(waiting({ bills_due: { count: 1, amount: 85000, oldest: "2026-10-01" } }), money, TODAY);

    expect(row).toEqual({
      key: "bills_due",
      title: "1 bill has fallen due",
      detail: "Rs 85,000, due 1 Oct. Confirm the real figure and post it.",
      to: "/tenant/expenses?tab=recurring",
    });
  });

  it("several bills are totalled and dated by the oldest", () => {
    const [row] = booksRows(waiting({ bills_due: { count: 3, amount: 109900, oldest: "2026-10-09" } }), money, TODAY);

    expect(row.title).toBe("3 bills have fallen due");
    expect(row.detail).toBe("Rs 109,900 in all, the oldest due yesterday. Confirm each figure and post it.");
  });

  it("a bill due today says today, mid-sentence", () => {
    const [row] = booksRows(waiting({ bills_due: { count: 1, amount: 6500, oldest: "2026-10-10" } }), money, TODAY);

    expect(row.detail).toBe("Rs 6,500, due today. Confirm the real figure and post it.");
  });

  it("one category over is named; its figure is how far past", () => {
    const [row] = booksRows(waiting({ over_budget: { count: 1, over_by: 6500, categories: ["Marketing"] } }), money, TODAY);

    expect(row).toEqual({
      key: "over_budget",
      title: "Marketing is over its budget",
      detail: "Rs 6,500 past the ceiling set for this month.",
      to: "/tenant/expenses?tab=budgets",
    });
  });

  it("several are counted, the worst three named, and the rest said", () => {
    const [row] = booksRows(
      waiting({ over_budget: { count: 5, over_by: 41200, categories: ["Marketing", "Travel", "Fuel"] } }),
      money,
      TODAY,
    );

    expect(row.title).toBe("5 categories are over budget");
    expect(row.detail).toBe("Marketing, Travel, Fuel and 2 more — Rs 41,200 past their ceilings this month.");

    const [two] = booksRows(waiting({ over_budget: { count: 2, over_by: 900, categories: ["Marketing", "Travel"] } }), money, TODAY);
    expect(two.detail).toBe("Marketing, Travel — Rs 900 past their ceilings this month.");
  });

  it("a payment that was expected is its own row, on the income side", () => {
    const [row] = booksRows(waiting({ income_due: { count: 1, amount: 150000, oldest: "2026-10-05" } }), money, TODAY);

    expect(row).toEqual({
      key: "income_due",
      title: "1 expected payment has fallen due",
      detail: "Rs 150,000, expected 5 Oct. Record it when it arrives.",
      to: "/tenant/income?tab=recurring",
    });

    const [many] = booksRows(waiting({ income_due: { count: 2, amount: 210000, oldest: "2026-09-28" } }), money, TODAY);
    expect(many.title).toBe("2 expected payments have fallen due");
    expect(many.detail).toBe("Rs 210,000 in all, the oldest expected 28 Sep. Record each one when it arrives.");
  });

  it("puts what is owed first, then what is overspent, then what is expected", () => {
    const rows = booksRows(
      {
        bills_due: { count: 1, amount: 1, oldest: "2026-10-01" },
        income_due: { count: 1, amount: 1, oldest: "2026-10-01" },
        over_budget: { count: 1, over_by: 1, categories: ["Fuel"] },
      },
      money,
      TODAY,
    );

    expect(rows.map((r) => r.key)).toEqual(["bills_due", "over_budget", "income_due"]);
  });
});

describe("the same thing as one sentence, for the head of the page", () => {
  it("says nothing when the books are waiting on nothing", () => {
    expect(booksSentence(quiet)).toBeNull();
    expect(booksSentence(null)).toBeNull();
  });

  it("a due bill is the alert, ahead of anything else", () => {
    const all: BooksWaiting = {
      bills_due: { count: 2, amount: 1, oldest: "2026-10-01" },
      income_due: { count: 1, amount: 1, oldest: "2026-10-01" },
      over_budget: { count: 1, over_by: 1, categories: ["Fuel"] },
    };

    expect(booksSentence(all)).toEqual({ tone: "alert", text: "2 bills have fallen due and are waiting to be posted." });
    expect(booksSentence(waiting({ bills_due: { count: 1, amount: 1, oldest: null } }))?.text).toBe(
      "1 bill has fallen due and is waiting to be posted.",
    );
  });

  it("then a passed budget, by name when there is one", () => {
    expect(booksSentence(waiting({ over_budget: { count: 1, over_by: 1, categories: ["Marketing"] } }))).toEqual({
      tone: "busy",
      text: "Marketing has gone past its budget this month.",
    });
    expect(booksSentence(waiting({ over_budget: { count: 3, over_by: 1, categories: ["a", "b", "c"] } }))?.text).toBe(
      "3 categories have gone past their budgets this month.",
    );
  });

  it("then a payment that was expected", () => {
    expect(booksSentence(waiting({ income_due: { count: 1, amount: 1, oldest: null } }))).toEqual({
      tone: "busy",
      text: "1 expected payment has fallen due.",
    });
    expect(booksSentence(waiting({ income_due: { count: 4, amount: 1, oldest: null } }))?.text).toBe("4 expected payments have fallen due.");
  });
});
