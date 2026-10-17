import { describe, expect, it } from "vitest";

import { aMonthAfter, dueOn } from "./installments";

describe("the installment calendar the form previews", () => {
  it("falls due on the same day each month — the 31st is the last day of a short month", () => {
    expect(dueOn("2027-01-31", 1)).toBe("2027-01-31");
    expect(dueOn("2027-01-31", 2)).toBe("2027-02-28");
    expect(dueOn("2027-01-31", 3)).toBe("2027-03-31");
    expect(dueOn("2026-11-15", 2)).toBe("2026-12-15");
    expect(dueOn("2026-11-15", 14)).toBe("2027-12-15");
    expect(aMonthAfter("2026-10-16")).toBe("2026-11-16");
  });
});
