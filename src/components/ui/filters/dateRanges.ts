/**
 * NAMED DATE RANGES — the arithmetic, with no screen attached.
 *
 * Every list on this platform that filters by date was doing it with two bare
 * text inputs and a hyphen. That is not a filter, it is a form: somebody who
 * wants "last month" has to know what month it is, how many days it had, and
 * type both ends without a typo — and the screen never once said what it had
 * ended up showing them.
 *
 * So the ranges get names. The name is the control; the dates are what the
 * control RESOLVES to, and both are shown together, because a menu that says
 * "Last 30 days" without saying "28 Jul – 26 Aug" is asking to be trusted
 * about the one thing the reader came to check.
 *
 * ── Why the arithmetic lives here and not in a component ───────────────
 *
 * Two reasons, and the second is the real one. It is testable in isolation —
 * month ends, quarter boundaries and a year rollover are exactly the cases a
 * screen test will never think to try. And it is written ONCE: the moment two
 * screens each work out "this month" for themselves is the moment one of them
 * starts on the 1st and the other on the 31st of the month before.
 *
 * ── Local dates, never toISOString ─────────────────────────────────────
 *
 * `toISOString()` converts to UTC first. In Karachi (UTC+5) that turns the 1st
 * of the month at midnight into the last day of the previous month, so every
 * range would silently start a day early for exactly the users this is built
 * for. Everything below is assembled from local Y/M/D parts.
 */

/** A range as the API takes it: inclusive `yyyy-mm-dd` ends, null = open. */
export interface DateRange {
  from: string | null;
  to: string | null;
}

export const EMPTY_RANGE: DateRange = { from: null, to: null };

export type RangeKey =
  | "all"
  | "today"
  | "yesterday"
  | "last_7"
  | "last_14"
  | "last_30"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_year";

/** The presets a list offers, in the order somebody reads them. */
export const RANGE_KEYS: readonly RangeKey[] = [
  "today",
  "yesterday",
  "last_7",
  "last_14",
  "last_30",
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
];

const LABELS: Record<RangeKey, string> = {
  all: "All time",
  today: "Today",
  yesterday: "Yesterday",
  last_7: "Last 7 days",
  last_14: "Last 14 days",
  last_30: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_year: "This year",
};

export function rangeName(key: RangeKey): string {
  return LABELS[key];
}

/** `yyyy-mm-dd` for a Date, read in the viewer's own timezone. */
export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

/** A `yyyy-mm-dd` back to a local Date at midnight — never `new Date(string)`,
 *  which reads a bare date as UTC and lands on the day before in Karachi. */
export function fromIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);

  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

const shift = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/**
 * What a named range means today.
 *
 * "Last 7 days" INCLUDES today — six days back plus today — which is what the
 * reference reads ("20 – 26 Aug" on the 26th) and what anybody means by it.
 * Counting seven days back would quietly show eight days of data.
 */
export function resolveRange(key: RangeKey, today: Date = new Date()): DateRange {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const iso = toIsoDate;

  switch (key) {
    case "all":
      return { from: null, to: null };
    case "today":
      return { from: iso(base), to: iso(base) };
    case "yesterday": {
      const day = shift(base, -1);

      return { from: iso(day), to: iso(day) };
    }
    case "last_7":
      return { from: iso(shift(base, -6)), to: iso(base) };
    case "last_14":
      return { from: iso(shift(base, -13)), to: iso(base) };
    case "last_30":
      return { from: iso(shift(base, -29)), to: iso(base) };
    case "this_month":
      return { from: iso(new Date(base.getFullYear(), base.getMonth(), 1)), to: iso(base) };
    case "last_month": {
      const first = new Date(base.getFullYear(), base.getMonth() - 1, 1);
      // Day 0 of this month is the last day of the previous one — the only
      // way to write it that is right in February and in a leap year.
      const last = new Date(base.getFullYear(), base.getMonth(), 0);

      return { from: iso(first), to: iso(last) };
    }
    case "this_quarter": {
      const first = new Date(base.getFullYear(), Math.floor(base.getMonth() / 3) * 3, 1);

      return { from: iso(first), to: iso(base) };
    }
    case "this_year":
      return { from: iso(new Date(base.getFullYear(), 0, 1)), to: iso(base) };
  }
}

/**
 * WHICH PRESET IS THIS, if any.
 *
 * The URL carries two dates, not a name — so a page restored from a link, a
 * bookmark or the back button has to work out for itself which row to tick.
 * Without this the menu would show a resolved range in the trigger and no
 * check beside anything in the list, which reads as "nothing is selected"
 * over a filtered screen.
 *
 * A custom range that happens to equal a preset is shown AS that preset, on
 * purpose: they are the same filter, and telling somebody they picked
 * something else is worse than agreeing with them.
 */
export function matchPreset(range: DateRange, today: Date = new Date()): RangeKey | null {
  if (range.from === null && range.to === null) return "all";

  return RANGE_KEYS.find((key) => {
    const preset = resolveRange(key, today);

    return preset.from === range.from && preset.to === range.to;
  }) ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "26 Aug" — the month named, because 08/09 is a different day in two countries. */
export function formatDay(iso: string): string {
  const date = fromIsoDate(iso);

  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/**
 * A range in as few characters as it can honestly be written.
 *
 *   one day            → "26 Aug"
 *   same month         → "1 – 26 Aug"
 *   crossing a month   → "28 Jul – 26 Aug"
 *   crossing a year    → "28 Dec 2025 – 3 Jan 2026"
 *   one end open       → "From 1 Aug" / "Until 26 Aug"
 */
export function formatRange(range: DateRange, today: Date = new Date()): string {
  const { from, to } = range;

  if (from === null && to === null) return "All time";
  if (from === null) return `Until ${formatDay(to!)}`;
  if (to === null) return `From ${formatDay(from)}`;

  const start = fromIsoDate(from);
  const end = fromIsoDate(to);
  const thisYear = today.getFullYear();
  const spansYears = start.getFullYear() !== end.getFullYear();
  // A year is only worth the space when it is not the one we are standing in.
  const year = (date: Date): string => (date.getFullYear() === thisYear && !spansYears ? "" : ` ${date.getFullYear()}`);

  if (from === to) return `${formatDay(from)}${year(start)}`;

  if (!spansYears && start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${formatDay(to)}${year(end)}`;
  }

  return `${formatDay(from)}${year(start)} – ${formatDay(to)}${year(end)}`;
}

/** Whichever way round they were clicked, `from` is the earlier one. */
export function orderRange(a: string, b: string): DateRange {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function isSameRange(a: DateRange, b: DateRange): boolean {
  return a.from === b.from && a.to === b.to;
}

/**
 * The days of one month as a 6×7 grid, Sunday first, with the neighbouring
 * days that fill the corners — the shape every calendar in the reference has,
 * and the one a component should never be computing inline.
 */
export function monthGrid(year: number, month: number): Array<{ iso: string; day: number; inMonth: boolean }> {
  const first = new Date(year, month, 1);
  const start = shift(first, -first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = shift(start, index);

    return { iso: toIsoDate(date), day: date.getDate(), inMonth: date.getMonth() === month };
  });
}

export function monthName(year: number, month: number): string {
  return `${new Date(year, month, 1).toLocaleDateString(undefined, { month: "long" })} ${year}`;
}
