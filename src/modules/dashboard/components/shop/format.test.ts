import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, humanizeEntity } from "./format";
// The percentage moved to `MetricTile`, which both consoles' strips render —
// it used to live here while the platform console formatted the same number a
// different way.
import { formatDelta } from "../deltaFormat";

/**
 * Dates that are days, not instants.
 *
 * The payload mixes ISO-8601 timestamps with plain calendar dates, and a
 * date-only string handed to `new Date()` is parsed as UTC midnight — which
 * renders as YESTERDAY for anyone west of Greenwich. A trading day, an expense
 * date and a stocktake date are all calendar days: they must read the same
 * everywhere, and off-by-one on a date is the kind of bug a shopkeeper spots
 * long before we do.
 */
describe("calendar dates survive the timezone", () => {
  it("a date-only string keeps its own day", () => {
    // Rebuilt in local time rather than parsed as UTC midnight. Whatever the
    // runner's zone, the 5th must render as the 5th.
    expect(formatDate("2026-08-05")).toContain("5");
    expect(formatDate("2026-08-05")).toContain("Aug");
  });

  it("a full timestamp is left to the browser", () => {
    expect(formatDate("2026-08-05T14:32:00+05:00")).toContain("Aug");
  });

  it("null and nonsense become an em dash rather than Invalid Date", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("a delta with no baseline is not a number", () => {
  it("renders a signed percentage", () => {
    expect(formatDelta(12.44)).toBe("+12.4%");
    expect(formatDelta(-8)).toBe("−8%");
  });

  it("returns null when there was nothing to compare against", () => {
    // There is no honest percentage against nothing, and "+100%" on a shop's
    // first day is a lie the UI must not tell.
    expect(formatDelta(null)).toBeNull();
    expect(formatDelta(undefined)).toBeNull();
  });
});

describe("audit entities read as nouns", () => {
  it("splits CamelCase", () => {
    expect(humanizeEntity("ProductBatch")).toBe("product batch");
    expect(humanizeEntity(undefined)).toBe("record");
  });
});
