import { describe, expect, it } from "vitest";

import { TRADE_FEATURES } from "../../test/tradeFeatures";
import { capital, kindOfBusiness } from "./kindOfBusiness";

describe("what kind of business is reading the screen", () => {
  it("a business that bought only the books does not sell, has no till, and is not a shop", () => {
    const office = kindOfBusiness(TRADE_FEATURES.finance);

    expect(office).toEqual({ sells: false, hasTill: false, buysFromSuppliers: false, sellsOnline: false, noun: "business" });
  });

  it("every trade that sells is a shop with a till", () => {
    for (const trade of ["food", "mart", "pharmacy", "retail", "services", "automotive", "petroleum"]) {
      const shop = kindOfBusiness(TRADE_FEATURES[trade]);

      expect(shop.sells, trade).toBe(true);
      expect(shop.hasTill, trade).toBe(true);
      expect(shop.noun, trade).toBe("shop");
    }
  });

  it("is asked of the modules, not of the trade", () => {
    // A Finance Manager who is given the till has a drawer from that moment…
    const withTill = kindOfBusiness({ ...TRADE_FEATURES.finance, pos: true });
    expect(withTill.hasTill).toBe(true);
    expect(withTill.sells).toBe(true);
    expect(withTill.noun).toBe("shop");

    // …and an online-only shop sells with no drawer at all.
    const online = kindOfBusiness({ products: true, marketplace: true, expenses: true });
    expect(online).toMatchObject({ sells: true, hasTill: false, sellsOnline: true, noun: "shop" });
  });

  it("a catalogue with nothing to sell it through is still a shop being set up", () => {
    expect(kindOfBusiness({ products: true }).noun).toBe("shop");
    expect(kindOfBusiness({ services: true }).noun).toBe("shop");
    expect(kindOfBusiness({ products: true }).sells).toBe(false);
  });

  it("knows a supplier book and a storefront when it has them", () => {
    expect(kindOfBusiness({ purchasing: true, inventory: true }).buysFromSuppliers).toBe(true);
    expect(kindOfBusiness({ inventory: true }).buysFromSuppliers).toBe(false);
    expect(kindOfBusiness({ marketplace: true }).sellsOnline).toBe(true);
    expect(kindOfBusiness({ pos: true }).sellsOnline).toBe(false);
  });

  it("a session with no module map yet is a business with nothing — never a crash", () => {
    expect(kindOfBusiness(undefined)).toEqual({ sells: false, hasTill: false, buysFromSuppliers: false, sellsOnline: false, noun: "business" });
    expect(kindOfBusiness(null).noun).toBe("business");
  });

  it("capitalises a noun for the start of a sentence", () => {
    expect(capital("shop")).toBe("Shop");
    expect(capital("business")).toBe("Business");
  });
});
