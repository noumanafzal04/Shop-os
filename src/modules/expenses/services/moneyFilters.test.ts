import { describe, expect, it } from "vitest";

import { activeFilterCount, toParams } from "./moneyFilters";

describe("how many filters are narrowing the view", () => {
  it("none, on a list nobody has narrowed", () => {
    expect(activeFilterCount({ page: 1 })).toBe(0);
    expect(activeFilterCount({ page: 3, sort: "amount", dir: "asc" })).toBe(0);
  });

  it("a date range is ONE filter, not two", () => {
    expect(activeFilterCount({ from: "2026-10-01", to: "2026-10-31" })).toBe(1);
    // Half a range is still one.
    expect(activeFilterCount({ from: "2026-10-01" })).toBe(1);
    expect(activeFilterCount({ to: "2026-10-31" })).toBe(1);
  });

  it("counts each other kind once, however many values it holds", () => {
    expect(
      activeFilterCount({
        search: "rent",
        category_id: ["a", "b", "c"],
        payment_method: ["cash", "card"],
        from: "2026-10-01",
        to: "2026-10-31",
        min_amount: "100",
        max_amount: "900",
      }),
    ).toBe(6);
  });

  it("blank boxes are not filters", () => {
    expect(activeFilterCount({ search: "   ", min_amount: " ", max_amount: "", category_id: [], payment_method: [], from: "", to: "" })).toBe(0);
  });

  it("on a screen that is always about a period, the period counts for nothing", () => {
    const ledger = { from: "2026-10-01", to: "2026-10-31" };

    expect(activeFilterCount(ledger, true)).toBe(0);
    expect(activeFilterCount({ ...ledger, search: "invoice 114" }, true)).toBe(1);
  });
});

describe("what is sent to the server", () => {
  it("leaves out what is blank, so an emptied box is not a filter of ''", () => {
    expect(toParams({ search: "  ", from: "", to: "", min_amount: "", category_id: [], page: 1 })).toEqual({ page: 1 });
  });

  it("joins the lists and trims the words", () => {
    expect(toParams({ search: " rent ", category_id: ["a", "b"], payment_method: ["cash"], from: "2026-10-01", to: "2026-10-31" })).toEqual({
      search: "rent",
      category_id: "a,b",
      payment_method: "cash",
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });
});
