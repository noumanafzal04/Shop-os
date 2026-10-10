import { describe, expect, it } from "vitest";

import { kindOfBusiness } from "../../common/tenant/kindOfBusiness";
import { TRADE_FEATURES } from "../../test/tradeFeatures";
import { ledgerSays, ledgerTypes } from "./ledgerShape";

const labels = (features: Record<string, boolean>) => ledgerTypes(kindOfBusiness(features)).map((t) => t.label);

describe("which kinds of line a business's ledger can hold", () => {
  it("a books-only business is offered Income and Expenses and nothing it cannot have", () => {
    expect(labels(TRADE_FEATURES.finance)).toEqual(["Income", "Expenses"]);
    expect(ledgerTypes(kindOfBusiness(TRADE_FEATURES.finance)).map((t) => t.value)).toEqual(["income", "expense"]);
  });

  it("a shop with a supplier book is offered all five, in order", () => {
    expect(labels(TRADE_FEATURES.mart)).toEqual(["Sales", "Income", "Expenses", "Refunds", "Supplier paid"]);
  });

  it("a shop that sells and buys from nobody is not offered Supplier paid", () => {
    expect(labels(TRADE_FEATURES.services)).toEqual(["Sales", "Income", "Expenses", "Refunds"]);
  });

  it("a books-only business given a supplier book gets that chip and still no Sales", () => {
    expect(labels({ expenses: true, inventory: true, purchasing: true })).toEqual(["Income", "Expenses", "Supplier paid"]);
  });

  it("says nothing about sales to a business that makes none", () => {
    expect(ledgerSays(kindOfBusiness(TRADE_FEATURES.finance))).toBe(
      "Every movement of money, in the order it happened, with the balance carried down.",
    );
    expect(ledgerSays(kindOfBusiness(TRADE_FEATURES.mart))).toMatch(/Sales and refunds are counted automatically/);
  });
});
