import { describe, expect, it } from "vitest";

import { renewalDue } from "./renewalDue";
import type { TenantPackage } from "./services/adminService";

const BASIC = { id: "p-basic", name: "Basic", price: 2499 };
const STANDARD = { id: "p-standard", name: "Standard", price: "4999.00" };

const bill = (over: Partial<TenantPackage["bill"]> = {}): TenantPackage["bill"] => ({
  plan: { name: "Basic", price: 2499, months: 1 },
  addons: [],
  addons_monthly: 0,
  addons_total: 0,
  total: 2499,
  ...over,
});

const WITH_ADDONS = bill({
  addons: [
    { key: "delivery", label: "Delivery", monthly: 1000, listed: 1000, own_price: false },
    { key: "kitchen", label: "Kitchen", monthly: 2000, listed: 2000, own_price: false },
    { key: "hrm", label: "Basic HR", monthly: 0, listed: null, own_price: false },
  ],
  addons_monthly: 3000,
  addons_total: 3000,
  total: 5499,
});

describe("what a shop would be paying, when its plan is renewed", () => {
  it("is the plan AND its add-ons — the figure that was on another card", () => {
    expect(renewalDue(WITH_ADDONS, "p-basic", BASIC)).toEqual({
      amount: 5499,
      // Two paid add-ons; the free one is not a line on anybody's bill.
      says: "Rs 2,499 plan + Rs 3,000 for 2 add-ons = Rs 5,499.",
    });
  });

  it("counts one add-on as one", () => {
    const one = bill({ addons: [{ key: "delivery", label: "Delivery", monthly: 1000, listed: 1000, own_price: false }], addons_monthly: 1000, addons_total: 1000, total: 3499 });

    expect(renewalDue(one, "p-basic", BASIC)?.says).toBe("Rs 2,499 plan + Rs 1,000 for 1 add-on = Rs 3,499.");
  });

  it("says so when there are no paid add-ons", () => {
    expect(renewalDue(bill(), "p-basic", BASIC)).toEqual({ amount: 2499, says: "Basic is Rs 2,499, and this shop has no paid add-ons." });
  });

  it("moving to ANOTHER plan offers that plan's price, and says the add-ons are not in it", () => {
    expect(renewalDue(WITH_ADDONS, "p-basic", STANDARD)).toEqual({
      amount: 4999,
      says: "Standard is Rs 4,999. Any add-ons are worked out once the shop is on it.",
    });
  });

  it("a shop on no plan yet is offered the price of the one being given", () => {
    expect(renewalDue(bill({ plan: { name: null, price: 0, months: 1 }, total: 0 }), null, BASIC)?.amount).toBe(2499);
    expect(renewalDue(null, null, BASIC)?.amount).toBe(2499);
  });

  it("offers nothing for a free plan, or before a plan is chosen", () => {
    expect(renewalDue(bill(), "p-basic", null)).toBeNull();
    expect(renewalDue(null, null, { id: "p-free", name: "Trial", price: 0 })).toBeNull();
    expect(renewalDue(bill({ plan: { name: "Trial", price: 0, months: 1 }, total: 0 }), "p-free", { id: "p-free", name: "Trial", price: 0 })).toBeNull();
  });
});
