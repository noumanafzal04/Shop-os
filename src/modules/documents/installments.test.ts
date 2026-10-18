import { describe, expect, it } from "vitest";

import { aMonthAfter, dueDayWords, dueOn } from "./installments";

describe("on the installment calendar the form previews", () => {
  it("falls due on the same day each month — the 31st is the last day of a short month", () => {
    expect(dueOn("2027-01-31", 1)).toBe("2027-01-31");
    expect(dueOn("2027-01-31", 2)).toBe("2027-02-28");
    expect(dueOn("2027-01-31", 3)).toBe("2027-03-31");
    expect(dueOn("2026-11-15", 2)).toBe("2026-12-15");
    expect(dueOn("2026-11-15", 14)).toBe("2027-12-15");
    expect(aMonthAfter("2026-10-16")).toBe("2026-11-16");
  });
});

describe("on the day it falls due, in words", () => {
  it("names the day of the month, and a short month's last day for a late one", () => {
    expect(dueDayWords("2026-11-16")).toBe("on the 16th");
    expect(dueDayWords("2026-11-01")).toBe("on the 1st");
    expect(dueDayWords("2026-11-02")).toBe("on the 2nd");
    expect(dueDayWords("2026-11-03")).toBe("on the 3rd");
    expect(dueDayWords("2026-11-11")).toBe("on the 11th");
    expect(dueDayWords("2026-11-12")).toBe("on the 12th");
    expect(dueDayWords("2026-11-22")).toBe("on the 22nd");
    expect(dueDayWords("2026-11-28")).toBe("on the 28th");
    expect(dueDayWords("2026-10-31")).toBe("on the 31st or last day");
  });
});
