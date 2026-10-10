import { describe, expect, it } from "vitest";

import { daysUntil, glanceAt } from "./shopAtAGlance";
import type { LimitUsage } from "../auth/types";

/**
 * The four things an admin opens a shop's page to ask, said first.
 *
 * Noon on Friday 9 October 2026 is "now" throughout.
 */
const NOW = new Date(2026, 9, 9, 12, 0, 0);
const at = (days: number, hour = 12) => new Date(2026, 9, 9 + days, hour, 0, 0).toISOString();

const usage = (key: string, used: number): LimitUsage => ({ key, used } as LimitUsage);
const bill = (price: number, months: number, addons = 0, total = price) => ({
  bill: { plan: { name: "Basic", price, months }, addons: Array.from({ length: addons }), total },
});

const by = (shop: Parameters<typeof glanceAt>[0], label: string) => glanceAt(shop, NOW).find((g) => g.label === label);

describe("what plan it is on", () => {
  it("names the plan and what it costs", () => {
    expect(by({ plan: { name: "Basic" }, package: bill(2499, 1) }, "Plan")).toEqual({
      label: "Plan", value: "Basic", hint: "Rs 2,499 a month", tone: "brand",
    });
    expect(by({ plan: { name: "Enterprise" }, package: bill(72000, 12) }, "Plan")?.hint).toBe("Rs 72,000 every 12 months");
  });

  it("says what to do about a shop on no plan — the state every kept demo starts in", () => {
    expect(by({ plan: null }, "Plan")).toEqual({
      label: "Plan", value: "No plan yet", hint: "Give it one — nothing is billed until then", tone: "amber",
    });
  });
});

describe("when it renews", () => {
  it("counts the days, and turns amber in the last week", () => {
    const far = by({ subscription_ends_at: at(116), subscription_state: "active" }, "Renews");
    expect(far?.hint).toBe("In 116 days");
    expect(far?.tone).toBe("green");

    expect(by({ subscription_ends_at: at(8), subscription_state: "active" }, "Renews")?.tone).toBe("green");
    // Seven days is when somebody should be rung.
    expect(by({ subscription_ends_at: at(7), subscription_state: "active" }, "Renews")).toMatchObject({ hint: "In 7 days", tone: "amber" });
    expect(by({ subscription_ends_at: at(1), subscription_state: "active" }, "Renews")?.hint).toBe("Tomorrow");
    // Six this evening is TODAY — not tomorrow, which is what rounding the
    // hours up made of it.
    expect(by({ subscription_ends_at: at(0, 18), subscription_state: "active" }, "Renews")?.hint).toBe("Today");
    expect(by({ subscription_ends_at: at(0, 9), subscription_state: "active" }, "Renews")?.hint).toBe("Today");
  });

  it("says a shop past its date is in grace, and until when", () => {
    const grace = by({ subscription_ends_at: at(-3), subscription_state: "grace", grace_ends_at: at(4) }, "Ran out");
    expect(grace?.tone).toBe("amber");
    expect(grace?.hint).toMatch(/^In grace — read-only from /);
    expect(by({ subscription_ends_at: at(-3), subscription_state: "grace" }, "Ran out")?.hint).toBe("In grace — still working, and due");
  });

  it("says a shop past its grace cannot change anything", () => {
    const out = by({ subscription_ends_at: at(-40), subscription_state: "read_only" }, "Ran out");
    expect(out?.tone).toBe("red");
    expect(out?.hint).toContain("cannot change anything");
  });

  it("says nothing is running for a shop that was never subscribed", () => {
    expect(by({ plan: null }, "Renews")).toEqual({ label: "Renews", value: "—", hint: "No subscription is running", tone: "slate" });
  });
});

describe("what it pays", () => {
  it("is the plan and its add-ons together, and how often", () => {
    expect(by({ package: bill(2499, 1, 2, 3499) }, "Pays")).toEqual({
      label: "Pays", value: "Rs 3,499", hint: "a month · 2 add-ons", tone: "slate",
    });
    expect(by({ package: bill(72000, 12, 1, 78000) }, "Pays")?.hint).toBe("every 12 months · 1 add-on");
    expect(by({ package: bill(2499, 1) }, "Pays")?.hint).toBe("a month · no add-ons");
  });

  it("is left out when the server did not say — never drawn as nought", () => {
    expect(by({ plan: { name: "Basic" } }, "Pays")).toBeUndefined();
  });
});

describe("how big it is", () => {
  it("counts what is in use, in words", () => {
    const shop = { limits_usage: [usage("branches", 3), usage("staff", 12), usage("registers", 5), usage("products", 400)] };
    expect(by(shop, "Size")).toEqual({ label: "Size", value: "3 branches", hint: "12 staff · 5 checkout lanes", tone: "sky" });
  });

  it("does not say '1 branches'", () => {
    const shop = { limits_usage: [usage("branches", 1), usage("staff", 1), usage("registers", 1)] };
    expect(by(shop, "Size")).toMatchObject({ value: "1 branch", hint: "1 member of staff · 1 checkout lane" });
  });

  it("is left out of a list row, where nobody counted", () => {
    expect(by({ plan: { name: "Basic" } }, "Size")).toBeUndefined();
  });
});

describe("the days between now and a moment", () => {
  it("is by the calendar, not by twenty-four hours", () => {
    // Later today and earlier today are both today.
    expect(daysUntil(at(0, 18), NOW)).toBe(0);
    expect(daysUntil(at(0, 9), NOW)).toBe(0);
    // One minute into tomorrow is tomorrow, though it is twelve hours away.
    expect(daysUntil(new Date(2026, 9, 10, 0, 1).toISOString(), NOW)).toBe(1);
    expect(daysUntil(at(2), NOW)).toBe(2);
    expect(daysUntil(at(-1, 23), NOW)).toBe(-1);
    // Across a month end.
    expect(daysUntil(new Date(2026, 10, 2, 8).toISOString(), NOW)).toBe(24);
  });
});
