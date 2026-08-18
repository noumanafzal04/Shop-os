import { describe, expect, it } from "vitest";

import { saleSubtitle } from "./saleSubtitle";

describe("a sale found by its slip has to show that slip", () => {
  it("leads with the slip number, because that is what the customer typed", () => {
    expect(saleSubtitle({ offline_number: "OFF-LANE1-A3F2-000042", customer_name: "Ahmed" }))
      .toBe("OFF-LANE1-A3F2-000042 · Ahmed");
  });

  it("still names the slip when nobody was attached to the sale", () => {
    // The commonest case at a till: no customer, and the slip is the ONLY
    // reference in existence for that sale.
    expect(saleSubtitle({ offline_number: "OFF-TILL-9B10-000007", customer_name: null }))
      .toBe("OFF-TILL-9B10-000007 · Walk-in");
  });

  it("says nothing about offline for a sale that was never offline", () => {
    // Almost every sale. A shop must not be told about a mode it never used.
    expect(saleSubtitle({ offline_number: null, customer_name: "Sana" })).toBe("Sana");
    expect(saleSubtitle({ customer_name: null })).toBe("Walk-in");
  });

  it("does not treat an empty string as a slip", () => {
    // A column that was written blank rather than null must not produce a
    // leading separator with nothing in front of it.
    expect(saleSubtitle({ offline_number: "", customer_name: "Bilal" })).toBe("Bilal");
  });
});
