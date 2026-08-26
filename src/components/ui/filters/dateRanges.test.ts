import { describe, expect, it } from "vitest";

import {
  formatEntryDate,
  formatRange,
  fromIsoDate,
  matchPreset,
  monthGrid,
  orderRange,
  RANGE_KEYS,
  resolveRange,
  toIsoDate,
} from "./dateRanges";

/**
 * Dates are where filters go wrong quietly, so these tests stand on the days
 * that break them: a month end, a leap year, a quarter boundary, a year
 * rollover, and Karachi's +5 offset — the one that turns midnight on the 1st
 * into the last day of the month before if anything ever reaches for
 * toISOString().
 */
// 26 Aug 2026, 09:00 local — the day in the reference design.
const TODAY = new Date(2026, 7, 26, 9, 0, 0);

describe("resolveRange", () => {
  it("counts today as one of the last seven days", () => {
    // 20–26 is seven days. Counting seven days BACK from the 26th would give
    // eight days of data under a label that promises seven.
    expect(resolveRange("last_7", TODAY)).toEqual({ from: "2026-08-20", to: "2026-08-26" });
  });

  it("resolves the presets the reference shows, to the dates it shows", () => {
    expect(resolveRange("today", TODAY)).toEqual({ from: "2026-08-26", to: "2026-08-26" });
    expect(resolveRange("yesterday", TODAY)).toEqual({ from: "2026-08-25", to: "2026-08-25" });
    expect(resolveRange("last_14", TODAY)).toEqual({ from: "2026-08-13", to: "2026-08-26" });
    expect(resolveRange("last_30", TODAY)).toEqual({ from: "2026-07-28", to: "2026-08-26" });
    expect(resolveRange("this_month", TODAY)).toEqual({ from: "2026-08-01", to: "2026-08-26" });
    expect(resolveRange("last_month", TODAY)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(resolveRange("this_quarter", TODAY)).toEqual({ from: "2026-07-01", to: "2026-08-26" });
  });

  it("ends last month on the right day in February, leap year included", () => {
    expect(resolveRange("last_month", new Date(2027, 2, 10))).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
    expect(resolveRange("last_month", new Date(2028, 2, 10))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("crosses a year backwards without landing in the wrong one", () => {
    expect(resolveRange("last_month", new Date(2027, 0, 15))).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(resolveRange("last_30", new Date(2027, 0, 5))).toEqual({
      from: "2026-12-07",
      to: "2027-01-05",
    });
  });

  it("starts each quarter on its own first month", () => {
    const firsts = [0, 3, 6, 9].map((month) => resolveRange("this_quarter", new Date(2026, month + 2, 20)).from);

    expect(firsts).toEqual(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]);
  });

  it("leaves both ends open for all time", () => {
    expect(resolveRange("all", TODAY)).toEqual({ from: null, to: null });
  });
});

describe("local dates", () => {
  it("does not shift a date by the viewer's timezone offset", () => {
    // The bug this guards: toISOString() on midnight local, east of UTC,
    // reports the previous day. Every "this month" would start on the 31st.
    const firstOfMonth = new Date(2026, 7, 1, 0, 0, 0);

    expect(toIsoDate(firstOfMonth)).toBe("2026-08-01");
    expect(toIsoDate(fromIsoDate("2026-08-01"))).toBe("2026-08-01");
  });
});

describe("matchPreset", () => {
  it("names the preset a pair of loose dates happens to be", () => {
    // The URL carries dates, not a name. Without this a page restored from a
    // link shows a filtered screen with nothing ticked in its own menu.
    expect(matchPreset({ from: "2026-08-01", to: "2026-08-26" }, TODAY)).toBe("this_month");
    expect(matchPreset({ from: null, to: null }, TODAY)).toBe("all");
  });

  it("says nothing for a range that is nobody's preset", () => {
    expect(matchPreset({ from: "2026-08-03", to: "2026-08-19" }, TODAY)).toBeNull();
  });

  it("can name every preset it offers", () => {
    // The denominator: a matcher that recognised two of nine would pass every
    // test above and leave seven rows in the menu that can never be ticked.
    const named = RANGE_KEYS.filter((key) => matchPreset(resolveRange(key, TODAY), TODAY) === key);

    expect(named).toEqual([...RANGE_KEYS]);
  });
});

describe("formatRange", () => {
  it("writes one day once", () => {
    expect(formatRange({ from: "2026-08-26", to: "2026-08-26" }, TODAY)).toBe("26 Aug");
  });

  it("names the month once when a range stays inside it", () => {
    expect(formatRange({ from: "2026-08-01", to: "2026-08-26" }, TODAY)).toBe("1 – 26 Aug");
  });

  it("names both months when a range crosses one", () => {
    expect(formatRange({ from: "2026-07-28", to: "2026-08-26" }, TODAY)).toBe("28 Jul – 26 Aug");
  });

  it("adds the year only when it is not the year we are standing in", () => {
    expect(formatRange({ from: "2025-12-28", to: "2026-01-03" }, TODAY)).toBe("28 Dec 2025 – 3 Jan 2026");
    expect(formatRange({ from: "2025-01-01", to: "2025-12-31" }, TODAY)).toBe("1 Jan 2025 – 31 Dec 2025");
  });

  it("says which end is open rather than inventing the other", () => {
    expect(formatRange({ from: "2026-08-01", to: null }, TODAY)).toBe("From 1 Aug");
    expect(formatRange({ from: null, to: "2026-08-26" }, TODAY)).toBe("Until 26 Aug");
    expect(formatRange({ from: null, to: null }, TODAY)).toBe("All time");
  });
});

describe("orderRange", () => {
  it("puts the earlier date first however it was clicked", () => {
    expect(orderRange("2026-08-26", "2026-08-01")).toEqual({ from: "2026-08-01", to: "2026-08-26" });
    expect(orderRange("2026-08-01", "2026-08-26")).toEqual({ from: "2026-08-01", to: "2026-08-26" });
  });
});

describe("monthGrid", () => {
  it("is six full weeks starting on a Sunday", () => {
    const grid = monthGrid(2026, 7);

    expect(grid).toHaveLength(42);
    expect(grid[0].iso).toBe("2026-07-26");
    expect(grid[41].iso).toBe("2026-09-05");
  });

  it("marks which days belong to the month being drawn", () => {
    const grid = monthGrid(2026, 7);

    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(31);
    expect(grid.find((cell) => cell.iso === "2026-08-01")?.inMonth).toBe(true);
    expect(grid.find((cell) => cell.iso === "2026-07-31")?.inMonth).toBe(false);
  });

  it("draws February in a leap year without losing the 29th", () => {
    const grid = monthGrid(2028, 1);

    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(29);
  });
});

describe("formatEntryDate", () => {
  it("names the two days a merchant is actually looking for", () => {
    expect(formatEntryDate("2026-08-26", { today: TODAY })).toBe("Today");
    expect(formatEntryDate("2026-08-25", { today: TODAY })).toBe("Yesterday");
  });

  it("drops the year when it is the one we are standing in", () => {
    expect(formatEntryDate("2026-08-24", { today: TODAY })).toBe("24 Aug");
  });

  it("keeps the year when it is not", () => {
    expect(formatEntryDate("2025-12-31", { today: TODAY })).toBe("31 Dec 2025");
  });

  it("reads a timestamp as the day it names, not the day before", () => {
    // The Karachi trap: `new Date("2026-08-26T00:00:00.000000Z")` in +5 is
    // still the 26th, but `new Date("2026-08-26")` parsed as UTC and then
    // read back through toISOString() in a negative offset is the 25th.
    // fromIsoDate never touches either, so the string decides.
    expect(formatEntryDate("2026-08-24T19:30:00.000000Z", { today: TODAY })).toBe("24 Aug");
  });

  it("can be asked for the date and nothing else", () => {
    // A column sorted by amount has no use for "Today" among the numbers.
    expect(formatEntryDate("2026-08-26", { today: TODAY, relative: false })).toBe("26 Aug");
  });

  it("says nothing rather than NaN when there is no date", () => {
    expect(formatEntryDate("", { today: TODAY })).toBe("—");
  });
});
