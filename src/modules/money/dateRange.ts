/**
 * A DATE RANGE FOR THE MONEY TAB — "custom filter, range date filter".
 *
 * The server already answers `period=custom&from=&to=` (ReportController);
 * the tab only offered fixed periods. These are the rules behind the range
 * sheet: quick presets, a month grid to pick from, and dates written as the
 * shop's LOCAL day — never `toISOString().slice(0, 10)`, which is yesterday
 * before 05:00 in Karachi.
 */
export interface DateRange {
  from: string; // YYYY-MM-DD, local
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day, as the server reads it. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Back from "YYYY-MM-DD" to a local midnight. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const PRESETS: Array<{ key: string; label: string; range: (now: Date) => DateRange }> = [
  { key: "yesterday", label: "Yesterday", range: (now) => ({ from: ymd(addDays(now, -1)), to: ymd(addDays(now, -1)) }) },
  { key: "last7", label: "Last 7 days", range: (now) => ({ from: ymd(addDays(now, -6)), to: ymd(now) }) },
  { key: "last30", label: "Last 30 days", range: (now) => ({ from: ymd(addDays(now, -29)), to: ymd(now) }) },
  {
    key: "lastMonth",
    label: "Last month",
    range: (now) => ({
      from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
    }),
  },
];

/**
 * A tap on the calendar. The first tap starts a range; the second ends it
 * (either order — a tap BEFORE the start becomes the start); a third starts
 * again. A day in the future cannot be picked: nothing was sold there.
 */
export function tapDay(current: { from: string | null; to: string | null }, day: string, today: string) {
  if (day > today) return current;
  if (!current.from || current.to) return { from: day, to: null };
  return day < current.from ? { from: day, to: current.from } : { from: current.from, to: day };
}

/** A month as rows of seven (Monday first), padded with nulls. */
export function monthGrid(year: number, month: number): Array<Array<string | null>> {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(ymd(new Date(year, month, d)));
  while (cells.length % 7) cells.push(null);
  const rows: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Nov – 20 Nov", "3 Nov", or with years when they differ. */
export function rangeLabel(r: DateRange): string {
  const a = parseYmd(r.from);
  const b = parseYmd(r.to);
  const day = (d: Date, year: boolean) => `${d.getDate()} ${MONTHS[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ""}`;
  if (r.from === r.to) return day(a, false);
  const years = a.getFullYear() !== b.getFullYear();
  return `${day(a, years)} – ${day(b, years)}`;
}

export const monthTitle = (year: number, month: number) =>
  `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month]} ${year}`;
