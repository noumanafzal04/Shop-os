import { describe, expect, it } from "vitest";

import { PERIODS, rangeError, rangeParams, resolveReportRange } from "./reportPeriod";

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
