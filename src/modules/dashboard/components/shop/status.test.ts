import { describe, expect, it } from "vitest";

import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { shopStatus } from "./status";

/**
 * The head of the dashboard says ONE thing, and it has to be true.
 *
 * It is the first sentence a shopkeeper reads in the morning. A line that
 * says "everything is moving" over a pass full of cold food is worse than no
 * line at all, so what is held here is the ORDER: the most pressing true
 * thing wins, and nothing is said that no figure stands behind.
 */

const caps = (over: Partial<Capabilities> = {}): Capabilities =>
  ({ sells: true, takesOrders: true, tracksStock: true, ...over }) as Capabilities;

const day = (over: Record<string, unknown> = {}): TenantDashboard =>
  ({
    today: { sales_count: 0 },
    pending_orders: 0,
    low_stock_count: 0,
    inventory: { low_stock: 0, out_of_stock: 0, expiring_soon: 0, pending_pos: 0 },
    till: null,
    floor: null,
    ...over,
  }) as unknown as TenantDashboard;

const floor = (over: Record<string, number> = {}) =>
  ({ tables: 12, occupied: 0, open_tabs: 0, kot_waiting: 0, kot_ready: 0, ...over });

describe("the one thing to know", () => {
  it("says nothing has happened when nothing has", () => {
    const status = shopStatus(day(), caps());

    expect(status.tone).toBe("calm");
    // A shop that has sold nothing yet is not "moving".
    expect(status.text).toBe("Nothing rung up yet today, and nothing needs you.");
    expect(status.text).not.toMatch(/moving/i);
  });

  it("only says the shop is moving once something has moved", () => {
    const status = shopStatus(day({ today: { sales_count: 14 } }), caps());

    expect(status.tone).toBe("calm");
    expect(status.text).toBe("Everything is moving — 14 sales so far today, and nothing needs you.");
  });

  it("counts one as one", () => {
    expect(shopStatus(day({ today: { sales_count: 1 } }), caps()).text).toContain("1 sale so far");
    expect(shopStatus(day({ floor: floor({ kot_ready: 1 }) }), caps()).text).toContain("1 order is ready");
  });

  it("a books-only business is not told about sales it cannot make", () => {
    expect(shopStatus(day(), caps({ sells: false })).text).toBe("Nothing needs you right now.");
  });
});

describe("the most pressing true thing wins", () => {
  // Everything wrong at once. Each case takes the top one away and expects
  // the next — so the ORDER is what is being tested, not six separate lines.
  const everything = {
    today: { sales_count: 30 },
    floor: floor({ occupied: 6, kot_waiting: 10, kot_ready: 2 }),
    pending_orders: 3,
    till: { unclosed_days: 1 },
    inventory: { low_stock: 4, out_of_stock: 2, expiring_soon: 0, pending_pos: 0 },
    low_stock_count: 4,
  };

  it("food going cold comes first", () => {
    const status = shopStatus(day(everything), caps());

    expect(status.tone).toBe("alert");
    expect(status.text).toBe("2 orders are ready on the pass, waiting to be carried.");
  });

  it("then a customer nobody has answered", () => {
    const status = shopStatus(day({ ...everything, floor: floor({ occupied: 6, kot_waiting: 10 }) }), caps());

    expect(status.tone).toBe("alert");
    expect(status.text).toBe("3 orders are waiting for you to accept.");
  });

  it("then a day left open", () => {
    const status = shopStatus(
      day({ ...everything, floor: floor({ occupied: 6, kot_waiting: 10 }), pending_orders: 0 }),
      caps(),
    );

    expect(status.text).toBe("1 earlier day is still open and not closed off.");
  });

  it("then the kitchen, then the floor", () => {
    const quiet = { ...everything, pending_orders: 0, till: null };

    expect(shopStatus(day({ ...quiet, floor: floor({ occupied: 6, kot_waiting: 10 }) }), caps())).toEqual({
      tone: "busy",
      text: "The kitchen is cooking 10 tickets — 6 of 12 tables sat.",
    });
    expect(shopStatus(day({ ...quiet, floor: floor({ occupied: 6 }) }), caps()).text)
      .toBe("6 of 12 tables are sat, and nothing is waiting on the kitchen.");
  });

  it("then the shelf: out before low", () => {
    const shop = { ...everything, floor: null, pending_orders: 0, till: null };

    expect(shopStatus(day(shop), caps()).text).toContain("2 items have run out");
    expect(shopStatus(day({ ...shop, inventory: { ...shop.inventory, out_of_stock: 0 } }), caps()).text)
      .toBe("4 items are running low.");
  });
});

describe("it never speaks for a module the shop does not have", () => {
  it("says nothing about orders to a shop that takes none", () => {
    const status = shopStatus(day({ pending_orders: 5, today: { sales_count: 2 } }), caps({ takesOrders: false }));

    expect(status.text).not.toMatch(/waiting for you/);
    expect(status.tone).toBe("calm");
  });

  it("says nothing about stock to a shop that counts none", () => {
    const status = shopStatus(
      day({ low_stock_count: 9, inventory: { low_stock: 9, out_of_stock: 9, expiring_soon: 0, pending_pos: 0 } }),
      caps({ tracksStock: false }),
    );

    expect(status.text).not.toMatch(/run out|running low/);
  });
});

describe("what the books are waiting on", () => {
  const none = { count: 0, amount: 0, oldest: null };
  const books = (over: Record<string, unknown> = {}) => ({
    bills_due: none,
    income_due: none,
    over_budget: { count: 0, over_by: 0, categories: [] },
    ...over,
  });
  const office = caps({ sells: false, takesOrders: false, tracksStock: false, keepsBooks: true });
  const entry = [{ id: "e1" }];

  it("a books-only business with a bill overdue is told so — not that nothing needs it", () => {
    // The only alert such a business can ever have, and the head of its
    // dashboard said "Nothing needs you right now" over it every morning.
    const status = shopStatus(
      day({ recent_expenses: entry, books: books({ bills_due: { count: 2, amount: 91500, oldest: "2026-10-01" } }) }),
      office,
    );

    expect(status).toEqual({ tone: "alert", text: "2 bills have fallen due and are waiting to be posted." });
  });

  it("a passed budget is said when no bill is due", () => {
    const status = shopStatus(
      day({ recent_expenses: entry, books: books({ over_budget: { count: 1, over_by: 6500, categories: ["Marketing"] } }) }),
      office,
    );

    expect(status).toEqual({ tone: "busy", text: "Marketing has gone past its budget this month." });
  });

  it("with nothing waiting and books that have entries, nothing needs it", () => {
    expect(shopStatus(day({ recent_expenses: entry, books: books() }), office)).toEqual({
      tone: "calm",
      text: "Nothing needs you right now.",
    });
  });

  it("empty books say so, in step with the panel below that says the same", () => {
    expect(shopStatus(day({ recent_expenses: [], books: books() }), office)).toEqual({
      tone: "calm",
      text: "Your books are empty — record your first income or expense to begin.",
    });
  });

  it("a shop's customer comes before its landlord", () => {
    const due = books({ bills_due: { count: 1, amount: 85000, oldest: "2026-10-01" } });
    const shop = caps({ keepsBooks: true });

    // An order nobody has accepted, and a shelf that has run out, come first…
    expect(shopStatus(day({ pending_orders: 2, books: due, recent_expenses: entry }), shop).text).toMatch(/waiting for you to accept/);
    expect(shopStatus(day({ inventory: { low_stock: 0, out_of_stock: 3, expiring_soon: 0, pending_pos: 0 }, books: due, recent_expenses: entry }), shop).text)
      .toMatch(/run out/);
    // …and the bill is still said ahead of "everything is moving".
    expect(shopStatus(day({ today: { sales_count: 9 }, books: due, recent_expenses: entry }), shop).text)
      .toBe("1 bill has fallen due and is waiting to be posted.");
  });

  it("a shop that keeps no books is never told about them", () => {
    const due = books({ bills_due: { count: 1, amount: 1, oldest: null } });

    expect(shopStatus(day({ books: due }), caps({ keepsBooks: false })).text).toBe("Nothing rung up yet today, and nothing needs you.");
  });

  it("an older server that sends no books block changes nothing", () => {
    expect(shopStatus(day({ recent_expenses: entry }), office).text).toBe("Nothing needs you right now.");
  });
});
