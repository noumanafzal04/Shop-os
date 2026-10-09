/**
 * THE PERIOD A DASHBOARD IS SHOWING — in words.
 *
 * Both consoles are asked about a period now (see `DashboardPeriod` on the
 * server, which owns the arithmetic). What is left for the screen is to SAY
 * it, and saying it had three ways to go wrong:
 *
 *   a tile still called "Today's Sales" over last month's figure
 *   a pill reading "+12%" with nothing to say what it is twelve per cent more than
 *   the two consoles each finding their own words for the same period
 *
 * So the words are worked out here, once, from what the SERVER says it
 * answered — `PeriodTold`, the `period` block of either payload — and not from
 * what the control asked for. For the moment between a click and its answer
 * those are different periods, and a label must describe the figure under it.
 */
import {
  formatRange,
  fromIsoDate,
  matchPreset,
  rangeName,
  type DateRange,
  type RangeKey,
} from "../../components/ui/filters";

/** The `period` block both dashboards carry. Mirrors `DashboardPeriod::toArray()`. */
export interface PeriodTold {
  from: string;
  to: string;
  /** Both ends counted. */
  days: number;
  /** What the pills are measured against — like for like, worked out by the server. */
  compared_from: string;
  compared_to: string;
  /** The date it is, on the clock the period was cut by. */
  today: string;
  /** False when nobody named a period and this is the one the screen opens on. */
  asked: boolean;
  /** What the chart draws, and how wide each of its points is. */
  series: { from: string; to: string; bucket: "day" | "week" | "month" };
}

/** What both dashboards offer, in the order somebody reads them. */
export const DASHBOARD_PRESETS: readonly RangeKey[] = [
  "today",
  "yesterday",
  "last_7",
  "last_30",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
];

/** Which of the three ways a figure's label is written. */
export type PeriodKind = "today" | "yesterday" | "other";

const rangeOf = (period: PeriodTold): DateRange => ({ from: period.from, to: period.to });
const todayOf = (period: PeriodTold): Date => fromIsoDate(period.today);

export function periodKind(period: PeriodTold): PeriodKind {
  if (period.from !== period.to) return "other";
  if (period.to === period.today) return "today";

  const preset = matchPreset(rangeOf(period), todayOf(period));

  return preset === "yesterday" ? "yesterday" : "other";
}

/**
 * What the period is CALLED: "Today", "Last 7 days", "This month" — or, for a
 * pair of dates nobody has a name for, the dates.
 */
export function periodName(period: PeriodTold): string {
  const preset = matchPreset(rangeOf(period), todayOf(period));

  return preset !== null && preset !== "all" ? rangeName(preset) : formatRange(rangeOf(period), todayOf(period));
}

/** The dates, written once: "9 Oct", "1 – 9 Oct". */
export function periodDates(period: PeriodTold): string {
  return formatRange(rangeOf(period), todayOf(period));
}

/**
 * What the pills are measured against, as the end of a sentence:
 * "compared with yesterday", "…with the day before", "…with 1 – 9 Sep".
 */
export function comparedWith(period: PeriodTold): string {
  const against: DateRange = { from: period.compared_from, to: period.compared_to };

  // One day is only ever what one day is set against.
  if (period.compared_from === period.compared_to) {
    return matchPreset(against, todayOf(period)) === "yesterday" ? "yesterday" : "the day before";
  }

  return formatRange(against, todayOf(period));
}

/**
 * A figure's label for this period.
 *
 * Today and yesterday are named ON the tile — "Today's Sales" is how a
 * shopkeeper says it, and it is the label the screen has always led with. Any
 * other period is named once, above the strip, and the tiles say only what
 * they are: nine tiles each ending "· 1 – 9 Oct" is nine labels nobody can
 * read to the end.
 */
export function periodLabels(period: PeriodTold): {
  sales: string;
  refunded: string;
  expenses: string;
  profit: string;
  moneyIn: string;
  moneyOut: string;
  net: string;
  /** "Orders" → "Orders Today", "Orders Yesterday", "Orders". */
  counted: (noun: string) => string;
} {
  const kind = periodKind(period);

  if (kind === "other") {
    return {
      sales: "Sales",
      refunded: "Refunded",
      expenses: "Expenses",
      profit: "Profit",
      moneyIn: "Money In",
      moneyOut: "Money Out",
      net: "Net",
      counted: (noun) => noun,
    };
  }

  const day = kind === "today" ? "Today" : "Yesterday";

  return {
    sales: `${day}'s Sales`,
    refunded: `Refunded ${day}`,
    expenses: `${day}'s Expenses`,
    profit: `${day}'s Profit`,
    moneyIn: `Money In ${day}`,
    moneyOut: `Money Out ${day}`,
    net: `Net ${day}`,
    counted: (noun) => `${noun} ${day}`,
  };
}

/** How wide each point of the chart is, as a caption: "A point a day". */
export function seriesGrain(period: PeriodTold): string {
  return { day: "a day", week: "a week", month: "a month" }[period.series.bucket];
}

/**
 * The line under the period's name: how long it is, and what it is set
 * against. A single day has no length worth stating.
 */
export function periodDetail(period: PeriodTold): string {
  const against = `Compared with ${comparedWith(period)}`;
  if (period.days === 1) return against;

  // The dates are said here only when the NAME is not already them.
  const named = periodName(period) !== periodDates(period);

  return `${named ? `${periodDates(period)} · ` : ""}${period.days} days · ${against.replace(/^C/, "c")}`;
}
