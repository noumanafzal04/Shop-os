import { describe, expect, it } from "vitest";

import { commissionIsWorthSaying } from "./CommissionOwed";

const nothing = { orders: 0, base: 0, amount: 0 };
const invoice = { number: "CI-1", period_start: null, period_end: null, orders_count: 2, amount: 90, status: "unpaid" as const };

describe("is there anything about commission to tell this business", () => {
  it("not when it cannot take an online order and owes nothing", () => {
    expect(commissionIsWorthSaying({ applies: false, rate: 4.5, outstanding: nothing, invoices: [] })).toBe(false);
  });

  it("yes for a shop with a storefront, at the platform's rate, before its first order", () => {
    expect(commissionIsWorthSaying({ applies: true, rate: 4.5, outstanding: nothing, invoices: [] })).toBe(true);
  });

  it("not when the platform charges nothing and nothing is owed", () => {
    expect(commissionIsWorthSaying({ applies: true, rate: 0, outstanding: nothing, invoices: [] })).toBe(false);
  });

  it("what was run up before the storefront was withdrawn is still said", () => {
    expect(commissionIsWorthSaying({ applies: false, rate: 4.5, outstanding: { orders: 2, base: 2000, amount: 90 }, invoices: [] })).toBe(true);
    expect(commissionIsWorthSaying({ applies: false, rate: 0, outstanding: nothing, invoices: [invoice] })).toBe(true);
  });

  it("an older server that does not say is treated as it always was", () => {
    expect(commissionIsWorthSaying({ rate: 4.5, outstanding: nothing, invoices: [] })).toBe(true);
    expect(commissionIsWorthSaying({ rate: 0, outstanding: nothing, invoices: [] })).toBe(false);
  });
});
