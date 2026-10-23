import { describe, expect, it } from "vitest";
import { outstandingHeading } from "./commissionWords";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Next rounds #28: "6.5% · 10,947.75" where 10,947.75 was 4.5% of the base. */
describe("the rate beside the money", () => {
  it("says the rate the waiting charges were raised at when today's differs", () => {
    expect(outstandingHeading(6.5, { orders: 30, base: 243282, amount: 10947.69 }, money)).toBe(
      "New orders 6.5% · 10,947.69 not yet billed across 30 orders, charged at 4.5% of 243,282.00",
    );
  });

  it("says nothing more when they were raised at today's rate", () => {
    expect(outstandingHeading(4.5, { orders: 1, base: 1000, amount: 45 }, money)).toBe("New orders 4.5% · 45.00 not yet billed across 1 order");
    expect(outstandingHeading(6.5, { orders: 0, base: 0, amount: 0 }, money)).toBe("New orders 6.5% · 0.00 not yet billed across 0 orders");
  });
});
