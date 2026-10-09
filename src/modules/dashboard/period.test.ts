import { describe, expect, it } from "vitest";

import {
  comparedWith,
  DASHBOARD_PRESETS,
  periodDates,
  periodDetail,
  periodKind,
  periodLabels,
  periodName,
  seriesGrain,
  type PeriodTold,
} from "./period";
import { RANGE_KEYS } from "../../components/ui/filters";

/**
 * The words on a dashboard, for the period the SERVER says it answered.
 *
 * Friday 9 October 2026 throughout — a month nine days old, so "this month",
 * "this quarter" and "the first nine days of October" are all the same two
 * dates and the name has to be chosen, not guessed.
 */
const TODAY = "2026-10-09";

function told(from: string, to: string, compared: [string, string], bucket: PeriodTold["series"]["bucket"] = "day"): PeriodTold {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

  return {
    from, to, days,
    compared_from: compared[0], compared_to: compared[1],
    today: TODAY, asked: true,
    series: { from, to, bucket },
  };
}

const today = told(TODAY, TODAY, ["2026-10-08", "2026-10-08"]);
const yesterday = told("2026-10-08", "2026-10-08", ["2026-10-07", "2026-10-07"]);
const aTuesday = told("2026-09-15", "2026-09-15", ["2026-09-14", "2026-09-14"]);
const week = told("2026-10-03", "2026-10-09", ["2026-09-26", "2026-10-02"]);
const month = told("2026-10-01", "2026-10-09", ["2026-09-01", "2026-09-09"]);
const picked = told("2026-09-12", "2026-09-18", ["2026-09-05", "2026-09-11"]);
const quarter = told("2026-07-01", "2026-09-30", ["2026-04-01", "2026-06-30"], "week");

describe("what a period is called", () => {
  it("is the name somebody would pick it by, when it has one", () => {
    expect(periodName(today)).toBe("Today");
    expect(periodName(yesterday)).toBe("Yesterday");
    expect(periodName(week)).toBe("Last 7 days");
    expect(periodName(month)).toBe("This month");
    expect(periodName(quarter)).toBe("Last quarter");
  });

  it("is its dates when nobody has a name for it", () => {
    expect(periodName(picked)).toBe("12 – 18 Sep");
    expect(periodName(aTuesday)).toBe("15 Sep");
  });

  it("can name every period the dashboards offer", () => {
    // Offered in the menu and not known to the matcher is a row that can
    // never be ticked, and a period that is never called by its name.
    expect(DASHBOARD_PRESETS.filter((key) => !RANGE_KEYS.includes(key))).toEqual([]);
  });
});

describe("what a figure is called", () => {
  it("keeps the label a shopkeeper says, for today and for yesterday", () => {
    expect(periodKind(today)).toBe("today");
    expect(periodLabels(today).sales).toBe("Today's Sales");
    expect(periodLabels(today).counted("Guests")).toBe("Guests Today");

    expect(periodKind(yesterday)).toBe("yesterday");
    expect(periodLabels(yesterday).profit).toBe("Yesterday's Profit");
    expect(periodLabels(yesterday).refunded).toBe("Refunded Yesterday");
    expect(periodLabels(yesterday).counted("Orders")).toBe("Orders Yesterday");
  });

  it("never says Today over a figure that is not today's", () => {
    for (const period of [aTuesday, week, month, picked, quarter]) {
      const labels = periodLabels(period);
      const all = [labels.sales, labels.refunded, labels.expenses, labels.profit, labels.moneyIn, labels.moneyOut, labels.net, labels.counted("Orders")];

      expect(all.filter((label) => /today|yesterday/i.test(label))).toEqual([]);
    }
    expect(periodLabels(week).sales).toBe("Sales");
    expect(periodLabels(week).counted("Orders")).toBe("Orders");
  });

  it("one day that is neither today nor yesterday is just a day", () => {
    expect(periodKind(aTuesday)).toBe("other");
  });
});

describe("what the pills are measured against", () => {
  it("says it in the reader's words, not the server's", () => {
    expect(comparedWith(today)).toBe("yesterday");
    expect(comparedWith(yesterday)).toBe("the day before");
    expect(comparedWith(aTuesday)).toBe("the day before");
    expect(comparedWith(week)).toBe("26 Sep – 2 Oct");
    // The first nine days of the month before — which is what the server set
    // it against, and not something a reader would assume.
    expect(comparedWith(month)).toBe("1 – 9 Sep");
  });
});

describe("the line under the name", () => {
  it("says only the comparison for a single day", () => {
    expect(periodDetail(today)).toBe("Compared with yesterday");
  });

  it("says the dates, the length and the comparison for a named run of days", () => {
    expect(periodDetail(month)).toBe("1 – 9 Oct · 9 days · compared with 1 – 9 Sep");
    expect(periodDetail(quarter)).toBe("1 Jul – 30 Sep · 92 days · compared with 1 Apr – 30 Jun");
  });

  it("does not repeat the dates when the dates ARE the name", () => {
    expect(periodDates(picked)).toBe("12 – 18 Sep");
    expect(periodDetail(picked)).toBe("7 days · compared with 5 – 11 Sep");
  });
});

describe("the chart's grain", () => {
  it("is said as the server cut it", () => {
    expect(seriesGrain(month)).toBe("a day");
    expect(seriesGrain(quarter)).toBe("a week");
  });
});
