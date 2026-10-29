import { describe, expect, it } from "vitest";
import { planSellsOffline } from "./planOffline";

/**
 * THE CREATE FORM SAYS WHAT THE PLAN SAYS ABOUT OFFLINE (admin #AD1).
 *
 * Pro, Standard and Enterprise all sell offline for 7 days; the form that
 * picks one for a new shop never said the word.
 */
const CREATE = Object.values(
  import.meta.glob("./pages/AdminTenantCreatePage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

describe("a plan's offline selling, in words", () => {
  it("names the days a plan allows", () => {
    expect(planSellsOffline({ offline_selling: 1, offline_days: 7 })).toBe("Up to 7 days");
    expect(planSellsOffline({ offline_selling: 1, offline_days: 1 })).toBe("Up to 1 day");
  });

  it("says when a plan does not include it", () => {
    expect(planSellsOffline({ offline_selling: 0, offline_days: 7 })).toBe("Not included");
    expect(planSellsOffline({ offline_selling: null, offline_days: null })).toBe("Not included");
    expect(planSellsOffline(undefined)).toBe("Not included");
  });

  it("is on the form that creates a shop, beside the plan it describes", () => {
    expect(CREATE).toMatch(/Selling offline: \{planSellsOffline\(selectedPlan\.limits\)/);
  });
});
