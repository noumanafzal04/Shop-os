import { describe, expect, it } from "vitest";

import { aMonthAfter, dueOn, split } from "./installments";

/** The same cases as the server's InstallmentScheduleTest — the preview may not drift from the plan. */
describe("the installment arithmetic the form previews", () => {
  it("rounds the month up to a rupee and lets the last month take the rest", () => {
    expect(split(50000, 10)).toEqual({ monthly: 5000, last: 5000 });
    expect(split(10000, 3)).toEqual({ monthly: 3334, last: 3332 });
    expect(split(10, 7)).toEqual({ monthly: 1.42, last: 1.48 });
    for (const [f, m] of [[50000, 10], [10000, 3], [44999.5, 12], [10, 7], [123457, 9]]) {
      const s = split(f, m);
      expect(s.monthly * (m - 1) + s.last).toBeCloseTo(f, 2);
      expect(s.last).toBeGreaterThan(0);
    }
  });

  it("falls due on the same day each month — the 31st is the last day of a short month", () => {
    expect(dueOn("2027-01-31", 1)).toBe("2027-01-31");
    expect(dueOn("2027-01-31", 2)).toBe("2027-02-28");
    expect(dueOn("2027-01-31", 3)).toBe("2027-03-31");
    expect(dueOn("2026-11-15", 2)).toBe("2026-12-15");
    expect(dueOn("2026-11-15", 14)).toBe("2027-12-15");
    expect(aMonthAfter("2026-10-16")).toBe("2026-11-16");
  });
});
