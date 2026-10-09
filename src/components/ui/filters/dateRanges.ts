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
 *
 * ── Whose "today" ──────────────────────────────────────────────────────
 *
 * The SHOP'S, not the device's. A shop's day turns at an hour of its own
 * (five in the morning unless it says otherwise — see common/shopDay.ts), and
 * the server answers every report by that day. "Today" pressed at one in the
 * morning has to ask for the evening that is still going, or it asks for a
 * day the server says has not begun and shows a restaurant mid-service an
 * empty list. Every default below is that day; a caller with no shop open
 * gets the device's date, as before.
 */
import { shopTodayDate } from "../../../common/shopDay";

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
  | "last_quarter"
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
  "last_quarter",
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
  last_quarter: "Last quarter",
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
export function resolveRange(key: RangeKey, today: Date = shopTodayDate()): DateRange {
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
    case "last_quarter": {
      const thisQuarter = Math.floor(base.getMonth() / 3) * 3;
      // Month −3 of January is October of the year before, and day 0 of this
      // quarter's first month is the last day of the one before it.
      const first = new Date(base.getFullYear(), thisQuarter - 3, 1);
      const last = new Date(base.getFullYear(), thisQuarter, 0);

      return { from: iso(first), to: iso(last) };
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
export function matchPreset(range: DateRange, today: Date = shopTodayDate()): RangeKey | null {
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
 * The date on a row of a list.
 *
 * Every money screen in the product printed `2026-08-24` — the wire format,
 * straight out of the JSON, fifteen times down a page. It is the one thing on
 * a books screen nobody can take in at a glance: the month is a number, the
 * year is repeated on every line whether or not it has changed, and the two
 * dates a merchant actually cares about — today and yesterday — look exactly
 * like the fortnight above them.
 *
 *   today              → "Today"
 *   yesterday          → "Yesterday"
 *   this year          → "24 Aug"
 *   any other year     → "24 Aug 2025"
 *
 * `relative: false` drops Today/Yesterday, for a column that is sorted by
 * something other than date and where a word among the numbers reads as noise.
 */
export function formatEntryDate(
  iso: string,
  { today = shopTodayDate(), relative = true }: { today?: Date; relative?: boolean } = {},
): string {
  if (!iso) return "—";
  const day = iso.slice(0, 10);
  const date = fromIsoDate(day);

  if (Number.isNaN(date.getTime())) return iso;

  if (relative) {
    if (day === toIsoDate(today)) return "Today";
    if (day === toIsoDate(shift(today, -1))) return "Yesterday";
  }

  const year = date.getFullYear() === today.getFullYear() ? "" : ` ${date.getFullYear()}`;

  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
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
export function formatRange(range: DateRange, today: Date = shopTodayDate()): string {
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

/**
 * THE SAME PERIOD, ONE ALONG — earlier or later.
 *
 * A dashboard is read a period at a time: today, then yesterday, then the day
 * before. Opening a menu for each step is three clicks to say "back one", so
 * the period control carries two arrows and this is what they do.
 *
 * What "one along" means depends on the SHAPE of the period, not its length:
 *
 *   a calendar month, quarter or year — whole, or so far — moves by one of
 *   those. September steps back to all of August (thirty-one days, not
 *   thirty), and forward to October as far as it has got.
 *
 *   anything else moves by its own length: a day by a day, seven days by
 *   seven, a picked fortnight by a fortnight.
 *
 * Forward stops at today. A step that would run past it is pulled back to end
 * on it; a period that already ends today has nowhere later to go, and the
 * answer is null — which is what disables the arrow.
 */
export function stepRange(range: DateRange, direction: -1 | 1, today: Date = shopTodayDate()): DateRange | null {
  if (range.from === null || range.to === null) return null;

  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = fromIsoDate(range.from);
  const to = fromIsoDate(range.to);
  if (direction === 1 && to >= now) return null;

  const months = calendarShape(from, to, now);

  if (months !== null) {
    // Never in the future: forward was refused above unless this period ended
    // before today, and the unit after one that has ended has begun.
    const first = new Date(from.getFullYear(), from.getMonth() + direction * months, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + months, 0);

    return { from: toIsoDate(first), to: toIsoDate(last > now ? now : last) };
  }

  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const end = shift(to, direction * days);
  // Pulled back to end today, keeping its length — "the next seven days" from
  // last week is the seven ending today, not four days and three of nothing.
  const last = end > now ? now : end;

  return { from: toIsoDate(shift(last, -(days - 1))), to: toIsoDate(last) };
}

/**
 * How many months wide a period's calendar shape is — 1, 3 or 12 — or null
 * when it is just a run of days.
 *
 * It has the shape when it starts on the first day of the unit and ends on
 * the unit's last day, or on today inside it ("this month", so far). A single
 * day never has one: the 1st, alone, steps back to the 31st and not to the
 * whole of the month before.
 */
function calendarShape(from: Date, to: Date, today: Date): 1 | 3 | 12 | null {
  if (from.getDate() !== 1 || from.getTime() === to.getTime()) return null;

  for (const months of [1, 3, 12] as const) {
    if (from.getMonth() % months !== 0) continue;
    const last = new Date(from.getFullYear(), from.getMonth() + months, 0);
    const inside = to >= from && to <= last;

    if (inside && (to.getTime() === last.getTime() || to.getTime() === today.getTime())) return months;
  }

  return null;
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
