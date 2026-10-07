import { describe, expect, it } from "vitest";
import { daysLeft, deskDate } from "./cover";

describe("the days of cover left, as the desk says them", () => {
  it("is a count of days — not the difference of two instants", () => {
    expect(daysLeft(365.9999999999884)).toBe("365 days left");
    expect(daysLeft(365)).toBe("365 days left");
  });

  it("is one day, in the singular", () => {
    expect(daysLeft(1)).toBe("1 day left");
    expect(daysLeft(1.4)).toBe("1 day left");
  });

  it("is the LAST day when none are left after today", () => {
    expect(daysLeft(0)).toBe("Last day of cover");
    expect(daysLeft(0.99)).toBe("Last day of cover");
  });

  it("is never a negative number of days, and never NaN", () => {
    expect(daysLeft(-3)).toBe("Last day of cover");
    expect(daysLeft(Number.NaN)).toBe("Last day of cover");
  });
});

describe("a date on the desk", () => {
  it("is the day a bare date names, wherever the browser is", () => {
    // New York: midnight UTC on the 7th is the evening of the 6th there, and
    // that is what `new Date("2027-10-07")` shows. The card says the 7th.
    const was = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(new Date("2027-10-07").getDate(), "this machine cannot stand west of Greenwich, so the case proves nothing").toBe(6);
      expect(deskDate("2027-10-07")).toMatch(/\b7\b/);
      expect(deskDate("2027-10-07")).not.toMatch(/\b6\b/);
      expect(deskDate("2027-10-07")).toContain("2027");
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
  });

  it("is a dash when there is none", () => {
    expect(deskDate(null)).toBe("—");
    expect(deskDate(undefined)).toBe("—");
    expect(deskDate("not a date")).toBe("—");
  });

  it("reads a full timestamp as the moment it is", () => {
    expect(deskDate("2026-10-07T06:57:43+00:00")).toContain("2026");
  });
});
