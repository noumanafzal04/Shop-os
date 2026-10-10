import { describe, expect, it } from "vitest";

import { kindOfBusiness } from "../../common/tenant/kindOfBusiness";
import { TRADE_FEATURES } from "../../test/tradeFeatures";
import { booksWords, withCashCalled } from "./booksWords";
import { PAYMENT_METHODS } from "./services/expensesService";

const office = booksWords(kindOfBusiness(TRADE_FEATURES.finance));
const shop = booksWords(kindOfBusiness(TRADE_FEATURES.mart));

describe("the words on the money screens", () => {
  it("a books-only business is never told about a till, a drawer, a shift or a sale", () => {
    for (const [key, said] of Object.entries(office)) {
      if (said === null) continue;

      expect(said, key).not.toMatch(/\btill\b|drawer|shift|\bsales?\b|\bshop\b/i);
    }
  });

  it("…and has nothing to hear about cash moving a drawer", () => {
    expect(office.cashPaidHint).toBeNull();
    expect(office.cashReceivedHint).toBeNull();
    expect(office.cashPaid).toBe("Cash");
    expect(office.cashReceived).toBe("Cash");
  });

  it("its Income screen is for what it takes in — not for what is NOT its income", () => {
    expect(office.income).toMatch(/^Everything the business takes in/);
    expect(office.income).toMatch(/a client's payment, a fee/);
    expect(office.noIncomeYet).toMatch(/A client's payment, a fee/);
    expect(office.incomeCategories).toMatch(/^What your money in is filed under/);
  });

  it("its Expenses screen says where a bill lands, and calls it a business", () => {
    expect(office.expenses).toBe(
      "Every bill the business has paid. File one and it lands in your cashbook, your ledger and your reports.",
    );
    expect(office.rentExample).toBe("e.g. July office rent");
    expect(office.incomeExample).toBe("e.g. Invoice 114 — client payment");
  });

  it("a shop with a till is told everything it was told before", () => {
    expect(shop.expenses).toBe(
      "Every bill the shop has paid. File one and it lands in your reports, your profit and — if it was cash — your drawer.",
    );
    expect(shop.income).toMatch(/Money in that isn't a sale/);
    expect(shop.income).toMatch(/Your sales revenue is counted automatically in the Cashbook/);
    expect(shop.incomeCategories).toMatch(/Where money in that isn't a sale gets filed/);
    expect(shop.noIncomeYet).toMatch(/Money in that isn't a sale/);
    expect(shop.cashPaid).toBe("Cash (from till)");
    expect(shop.cashReceived).toBe("Cash (to till)");
    expect(shop.cashPaidHint).toMatch(/comes out of your open drawer/);
    expect(shop.cashReceivedHint).toMatch(/goes into your open drawer/);
    expect(shop.rentExample).toBe("e.g. July shop rent");
    expect(shop.incomeExample).toBe("e.g. Owner cash injection");
  });

  it("a shop that sells online with no till has sales and no drawer", () => {
    const online = booksWords(kindOfBusiness({ products: true, marketplace: true, expenses: true }));

    expect(online.income).toMatch(/Money in that isn't a sale/);
    expect(online.cashPaid).toBe("Cash");
    expect(online.cashPaidHint).toBeNull();
    expect(online.expenses).toBe(
      "Every bill the shop has paid. File one and it lands in your cashbook, your ledger and your reports.",
    );
  });

  it("renames cash in a method list and leaves the rest alone", () => {
    const listed = withCashCalled(PAYMENT_METHODS, "Cash");

    expect(listed.map((m) => m.value)).toEqual(PAYMENT_METHODS.map((m) => m.value));
    expect(listed[0]).toEqual({ value: "cash", label: "Cash" });
    expect(listed.slice(1).map((m) => m.label)).toEqual(PAYMENT_METHODS.slice(1).map((m) => m.label));
  });
});
