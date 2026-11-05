import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { khataOutlook } from "./khataOutlook";

/**
 * A wholesaler sells to a dealer on credit: before pressing Complete the till
 * says what the dealer owes now, after this bill, and the room left under the
 * limit — and warns when this bill would cross it (the server refuses that).
 */
describe("where this bill leaves the khata", () => {
  it("a dealer owing nothing, limit 150,000, a bill of 75,150", () => {
    expect(khataOutlook({ balance: 0, limit: 150000, adding: 75150 })).toEqual({ owes: 0, after: 75150, limit: 150000, left: 74850, over: 0 });
  });

  it("a bill that crosses the limit says by how much", () => {
    const k = khataOutlook({ balance: "120000.00", limit: "150000.00", adding: 40000 })!;
    expect(k.after).toBe(160000);
    expect(k.over).toBe(10000);
    expect(k.left).toBe(0);
  });

  it("exactly at the limit is allowed, a paisa over is not — as the server holds it", () => {
    expect(khataOutlook({ balance: 100000, limit: 150000, adding: 50000 })!.over).toBe(0);
    expect(khataOutlook({ balance: 100000, limit: 150000, adding: 50000.01 })!.over).toBe(0.01);
  });

  it("no limit set is no limit; a limit of 0 is no credit at all", () => {
    expect(khataOutlook({ balance: 500, limit: null, adding: 1000000 })).toMatchObject({ limit: null, left: null, over: 0 });
    expect(khataOutlook({ balance: 0, limit: 0, adding: 100 })!.over).toBe(100);
  });

  it("a customer paid ahead starts below zero", () => {
    expect(khataOutlook({ balance: -2000, limit: 10000, adding: 5000 })).toMatchObject({ owes: -2000, after: 3000, left: 7000 });
  });

  it("says nothing for a customer the till knows nothing about", () => {
    expect(khataOutlook({ balance: undefined, limit: 150000, adding: 10 })).toBeNull();
  });

  it("the tender sheet shows it, from the lookup the till already makes", () => {
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");
    expect(till).toMatch(/setCustomerKhata\(\{ balance: data\.credit_balance, limit: data\.credit_limit \}\)/);
    expect(till).toContain("khataOutlook({");
    expect(till).toContain("data-khata-outlook");
  });
});
