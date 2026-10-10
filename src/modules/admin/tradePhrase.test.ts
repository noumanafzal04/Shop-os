import { describe, expect, it } from "vitest";

import { tradePhrase } from "./tradePhrase";

describe("what to call a business of a given trade", () => {
  it("says what each trade is — never 'a <label> shop'", () => {
    expect(tradePhrase("finance", "Finance Manager")).toBe("a books-only business");
    expect(tradePhrase("automotive", "Auto & Tyre")).toBe("an auto workshop");
    expect(tradePhrase("online", "Online Store")).toBe("an online shop");
    expect(tradePhrase("retail", "Retail Store")).toBe("a retail shop");
    expect(tradePhrase("food", "Food & Restaurant")).toBe("a restaurant");
    expect(tradePhrase("mart", "Mart & Grocery")).toBe("a mart");
    expect(tradePhrase("pharmacy", "Pharmacy & Medical")).toBe("a pharmacy");
    expect(tradePhrase("services", "Services")).toBe("a service business");
    expect(tradePhrase("petroleum", "Petroleum & Energy")).toBe("a fuel station");
  });

  it("no phrase names a trade a shop that is not one", () => {
    for (const code of ["finance", "services"]) {
      expect(tradePhrase(code)).not.toMatch(/\bshop\b/);
    }
  });

  it("a trade it has never heard of is still grammatical", () => {
    expect(tradePhrase("bakery", "Bakery")).toBe("a bakery business");
    expect(tradePhrase("optician", "Optician")).toBe("an optician business");
  });

  it("no trade at all is said plainly", () => {
    expect(tradePhrase(null)).toBe("this kind of business");
    expect(tradePhrase(undefined, "  ")).toBe("this kind of business");
  });
});
