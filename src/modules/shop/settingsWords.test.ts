import { describe, expect, it } from "vitest";

import { kindOfBusiness } from "../../common/tenant/kindOfBusiness";
import { TRADE_FEATURES } from "../../test/tradeFeatures";
import { settingsWords } from "./settingsWords";

describe("what the Business tab of Settings says", () => {
  const office = settingsWords(kindOfBusiness(TRADE_FEATURES.finance));
  const shop = settingsWords(kindOfBusiness(TRADE_FEATURES.mart));

  it("a books-only business is not told about invoices, a storefront, delivery or a shop", () => {
    for (const [key, said] of Object.entries(office)) {
      if (typeof said !== "string" || key === "onlineOff") continue;

      expect(said, key).not.toMatch(/invoice|storefront|delivery|receipt|\bshop/i);
    }
    expect(office.lede).toBe("Manage your business profile, location and how the app works for you.");
    expect(office.logoTitle).toBe("Logo");
  });

  it("…and is not offered an online shop it has nothing to list on", () => {
    expect(office.offersOnlineShop).toBe(false);
  });

  it("a shop is told what it was always told", () => {
    expect(shop.lede).toBe("Manage your shop profile, location and how the app works for you.");
    expect(shop.profile).toBe("Your shop's name and contact — shown on invoices and your storefront.");
    expect(shop.logoTitle).toBe("Shop logo");
    expect(shop.logoWhere).toMatch(/on your\s+invoices/);
    expect(shop.logoPrints).toMatch(/under Invoice \/ receipt/);
    expect(shop.location).toMatch(/powers delivery/);
    expect(shop.offersOnlineShop).toBe(true);
  });

  it("a shop without online selling is not told its plan is something else", () => {
    expect(shop.onlineOff).not.toMatch(/Expense Manager/);
    expect(shop.onlineOff).toBe("Online selling is not switched on for your shop. Contact support to add it.");
  });
});
