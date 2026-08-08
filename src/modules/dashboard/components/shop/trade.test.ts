import { describe, expect, it } from "vitest";

import { tradeProfile } from "./trade";

/**
 * The three trades that pay the bills get the tile they open the app for.
 *
 * These are behaviour tests, not snapshot tests of the table: each one names
 * the shopkeeper's question it exists to answer, so a later edit that "tidies"
 * the profiles has to argue with the reason rather than just the value.
 */
describe("trade profiles", () => {
  it("puts expiry ahead of shortage for a pharmacy, and the reverse for a mart", () => {
    // Same module, opposite question: a grocer's short shelf is a lost sale; a
    // pharmacist's dated strip is stock already paid for and about to be waste.
    expect(tradeProfile("pharmacy").focus[0]).toBe("expiring");
    expect(tradeProfile("mart").focus[0]).toBe("lowStock");
  });

  it("leads a kitchen with the pass, not the store room", () => {
    expect(tradeProfile("food").focus[0]).toBe("pipeline");
  });

  it("leads a services shop with its catalog — there is no shelf to run down", () => {
    expect(tradeProfile("services").focus[0]).toBe("catalog");
  });

  it("calls transactions what the trade calls them", () => {
    expect(tradeProfile("automotive").orders).toBe("Jobs Today");
    expect(tradeProfile("services").customers).toBe("Clients Today");
    expect(tradeProfile("mart").customers).toBe("Shoppers Today");
    expect(tradeProfile("food").customers).toBe("Guests Today");
  });

  it("gives every trade a fallback chain, never a single option", () => {
    // A one-entry chain means a shop lacking that one module gets a blank slot.
    for (const type of ["food", "mart", "pharmacy", "retail", "services", "automotive", "petroleum"]) {
      expect(tradeProfile(type).focus.length, `${type} has no fallback`).toBeGreaterThan(1);
    }
  });

  it("falls back to the default for an unknown or missing type", () => {
    const fallback = tradeProfile(null);
    expect(fallback.orders).toBe("Orders Today");
    expect(fallback.customers).toBe("Customers Today");
    expect(tradeProfile("something-we-never-shipped")).toEqual(fallback);
  });

  it("never leaves a trade without both labels", () => {
    for (const type of ["food", "mart", "pharmacy", "retail", "services", "automotive", "petroleum", null]) {
      const p = tradeProfile(type);
      expect(p.orders, `${type} orders`).toBeTruthy();
      expect(p.customers, `${type} customers`).toBeTruthy();
    }
  });
});
