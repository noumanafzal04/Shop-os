import { describe, expect, it } from "vitest";

import { PERIODS, rangeError, rangeParams, resolveReportRange, taxYearRange } from "./reportPeriod";
import { presetRange } from "./services/moneyFilters";

/**
 * The window a report covers.
 *
 * Two things are being guarded. First, that a custom range is REACHABLE at all
 * — the server has validated `period=custom&from&to` since the reports were
 * written and the panel offered four fixed buttons, so the whole capability sat
 * there unusable.
 *
 * Second, that this resolver agrees with the server's. Every named period is
 * computed in two places (here, for the header and for the reports that take a
 * plain from/to; and in App\Services\ReportService::resolvePeriod, for the ones
 * that take a period) and the moment they disagree, two tabs of one screen
 * report different weeks without saying so. That is exactly what happened
 * before: the receipt-copies tab started its week on Sunday, Carbon starts it
 * on Monday.
 */

// A Wednesday, mid-month, mid-year — every boundary is a different date.
const WEDNESDAY = new Date(2026, 7, 12); // 12 Aug 2026

describe("named periods resolve the way the server resolves them", () => {
  it("today is one day", () => {
    expect(resolveReportRange("daily", undefined, undefined, WEDNESDAY)).toEqual({
      period: "daily", from: "2026-08-12", to: "2026-08-12",
    });
  });

  it("a week runs Monday to Sunday, as Carbon does", () => {
    expect(resolveReportRange("weekly", undefined, undefined, WEDNESDAY)).toEqual({
      period: "weekly", from: "2026-08-10", to: "2026-08-16",
    });
  });

  it("a Sunday still belongs to the week that began the Monday before", () => {
    const sunday = new Date(2026, 7, 16);

    expect(resolveReportRange("weekly", undefined, undefined, sunday).from).toBe("2026-08-10");
  });

  it("a Monday is the first day of its own week, not the last of the previous", () => {
    const monday = new Date(2026, 7, 10);

    expect(resolveReportRange("weekly", undefined, undefined, monday)).toEqual({
      period: "weekly", from: "2026-08-10", to: "2026-08-16",
    });
  });

  it("a month runs to its real last day", () => {
    expect(resolveReportRange("monthly", undefined, undefined, WEDNESDAY)).toEqual({
      period: "monthly", from: "2026-08-01", to: "2026-08-31",
    });
  });

  it("February knows how long it is", () => {
    expect(resolveReportRange("monthly", undefined, undefined, new Date(2028, 1, 9)).to).toBe("2028-02-29");
  });

  it("a year is the calendar year", () => {
    expect(resolveReportRange("yearly", undefined, undefined, WEDNESDAY)).toEqual({
      period: "yearly", from: "2026-01-01", to: "2026-12-31",
    });
  });
});

/**
 * FBR's year runs 1 July – 30 June. The annual return, the audited accounts and
 * every advance-tax working sit inside that window, so a calendar-year total is
 * a figure nobody submits. Mirrors App\Support\TaxYear — these cases exist on
 * both sides deliberately.
 */
describe("the tax year is the one a business here files against", () => {
  it("August belongs to the year that opened the July before it", () => {
    expect(resolveReportRange("tax_year", undefined, undefined, WEDNESDAY)).toEqual({
      period: "tax_year", from: "2026-07-01", to: "2027-06-30",
    });
  });

  it("March belongs to the year that opened LAST July", () => {
    // The month an accountant is most likely to ask in, and the one where the
    // calendar year gives entirely the wrong twelve months.
    expect(taxYearRange(new Date(2026, 2, 15))).toEqual({
      from: "2025-07-01", to: "2026-06-30",
    });
  });

  it("30 June closes the year it is in", () => {
    expect(taxYearRange(new Date(2026, 5, 30))).toEqual({ from: "2025-07-01", to: "2026-06-30" });
  });

  it("1 July opens the next one", () => {
    // One day either side of this is a different return.
    expect(taxYearRange(new Date(2026, 6, 1))).toEqual({ from: "2026-07-01", to: "2027-06-30" });
  });

  it("is a whole year even across a leap February", () => {
    expect(taxYearRange(new Date(2028, 1, 29))).toEqual({ from: "2027-07-01", to: "2028-06-30" });
  });

  it("is offered in the picker, and has not displaced the calendar year", () => {
    const keys = PERIODS.map(([key]) => key);

    expect(keys).toContain("tax_year");
    expect(keys).toContain("yearly");
  });

  it("agrees with the money screens' own preset, to the day", () => {
    // The two are computed separately — this is the pair that has already
    // drifted once in this codebase, by a day, over which day a week starts.
    for (const day of [new Date(2026, 2, 15), new Date(2026, 5, 30), new Date(2026, 6, 1)]) {
      const report = resolveReportRange("tax_year", undefined, undefined, day);

      expect(presetRange("tax_year", day)).toEqual({ from: report.from, to: report.to });
    }
  });
});

describe("a custom range is what the merchant typed", () => {
  it("keeps both dates", () => {
    expect(resolveReportRange("custom", "2026-03-01", "2026-03-15", WEDNESDAY)).toEqual({
      period: "custom", from: "2026-03-01", to: "2026-03-15",
    });
  });

  it("falls back to this month so far, the same default the server uses", () => {
    expect(resolveReportRange("custom", undefined, undefined, WEDNESDAY)).toEqual({
      period: "custom", from: "2026-08-01", to: "2026-08-12",
    });
  });
});

describe("the range is refused before it costs a round trip", () => {
  it("rejects an end date before the start, in the server's words", () => {
    expect(rangeError({ period: "custom", from: "2026-08-20", to: "2026-08-01" }))
      .toBe("The end date must be on or after the start date.");
  });

  it("accepts a single-day range", () => {
    expect(rangeError({ period: "custom", from: "2026-08-01", to: "2026-08-01" })).toBeNull();
  });

  it("never blocks a named period", () => {
    expect(rangeError({ period: "weekly", from: "2026-08-20", to: "2026-08-01" })).toBeNull();
  });
});

describe("every report call carries the same window", () => {
  it("sends the resolved dates alongside the period name", () => {
    const range = resolveReportRange("weekly", undefined, undefined, WEDNESDAY);

    // The named arms ignore from/to server-side, so this is harmless there —
    // and it means one shape reaches every report rather than two that drift.
    expect(rangeParams(range)).toEqual({ period: "weekly", from: "2026-08-10", to: "2026-08-16" });
  });

  it("offers a custom range in the picker at all", () => {
    expect(PERIODS.map(([key]) => key)).toContain("custom");
  });
});
