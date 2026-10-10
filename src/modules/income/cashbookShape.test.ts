import { describe, expect, it } from "vitest";

import { kindOfBusiness } from "../../common/tenant/kindOfBusiness";
import { TRADE_FEATURES } from "../../test/tradeFeatures";
import { cashbookShape } from "./cashbookShape";

describe("what the cashbook looks like for this business", () => {
  it("a books-only business sees Income and Expenses — no column it can never fill", () => {
    const shape = cashbookShape(kindOfBusiness(TRADE_FEATURES.finance));

    expect(shape.columns).toEqual([
      { key: "other_income", label: "Income" },
      { key: "expenses", label: "Expenses" },
    ]);
    expect(shape.splits).toBe(false);
  });

  it("…and is not told about sales it does not make or a till it does not have", () => {
    const shape = cashbookShape(kindOfBusiness(TRADE_FEATURES.finance));

    expect(shape.footnote).toBeNull();
    expect(shape.says).not.toMatch(/sale|refund|till|drawer|POS|shift/i);
    expect(shape.says).toMatch(/income you recorded against the expenses you recorded/);
  });

  it("a shop keeps all four columns, the split, and the word about the drawer", () => {
    for (const trade of ["mart", "food", "pharmacy", "retail", "services", "automotive", "petroleum"]) {
      const shape = cashbookShape(kindOfBusiness(TRADE_FEATURES[trade]));

      expect(shape.columns.map((c) => c.label), trade).toEqual(["Sales", "Other income", "Expenses", "Refunds"]);
      expect(shape.columns.map((c) => c.key), trade).toEqual(["sales_revenue", "other_income", "expenses", "refunds"]);
      expect(shape.splits, trade).toBe(true);
      expect(shape.says, trade).toMatch(/Sales are counted automatically/);
      expect(shape.footnote, trade).toMatch(/use the POS shift close/);
    }
  });

  it("a shop that sells with no till is not sent to a shift close it does not have", () => {
    const online = cashbookShape(kindOfBusiness({ products: true, marketplace: true, expenses: true }));

    expect(online.columns).toHaveLength(4);
    expect(online.footnote).not.toBeNull();
    expect(online.footnote).not.toMatch(/POS|shift|drawer/);
    expect(online.footnote).toMatch(/booked across all payment types/);
  });
});
