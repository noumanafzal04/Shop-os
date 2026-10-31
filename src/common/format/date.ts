/**
 * A DATE, WRITTEN THE WAY THIS SHOP WRITES DATES.
 *
 *     "date ka format setting main hona chahye — for international?"
 *
 * Every screen wrote its dates with `toLocaleDateString()`, which is the
 * BROWSER's opinion: on one laptop the twelfth of October was "10/12/2026" —
 * the tenth of December, to a shopkeeper in Lahore — and on the next it was
 * "12/10/2026". The receipt beside it said "12 Oct 2026".
 *
 * A shop chooses one way from a short list (the server's, in
 * `App\Support\DateFormats`), and this file writes a date that way and from
 * nothing else: not the browser's language, and not a pattern of its own.
 * `fixtures/date-format.json` is made by the server (`DateFormatFixturesTest`)
 * and `date.test.ts` holds this file to every string in it, so a screen cannot
 * say 12/10 beside a paper that says 10/12.
 *
 * Two kinds of thing are called a date, and they are not the same:
 *
 *   a DAY      "2026-10-12" — a quotation's last day, an expiry, a filter's
 *              edge. It is the day it says wherever it is read, and is never
 *              moved to a time zone. (`new Date("2026-10-12")` is midnight in
 *              London, which is still the 11th in New York.)
 *   a MOMENT   "2026-10-12T07:14:20Z" — when a sale was rung. It is written as
 *              the clock in front of the reader had it.
 */

export type DateFormatCode = "dmy_text" | "dmy" | "mdy" | "ymd";

/** Day, the month's name, the year: there is no second way to read it. */
export const DEFAULT_DATE_FORMAT: DateFormatCode = "dmy_text";

export const DATE_FORMAT_CODES: readonly DateFormatCode[] = ["dmy_text", "dmy", "mdy", "ymd"];

/** A shop's format as the server sent it — or the default, when it has not arrived or is not one. */
export function dateFormatOf(sent: unknown): DateFormatCode {
  return typeof sent === "string" && (DATE_FORMAT_CODES as readonly string[]).includes(sent) ? (sent as DateFormatCode) : DEFAULT_DATE_FORMAT;
}

export type Datish = string | number | Date | null | undefined;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (n: number) => String(n).padStart(2, "0");

interface Parts { y: number; m: number; d: number; hh: number; mm: number }

/** A day that exists: the 31st of February does not. */
function real(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) return false;

  return d <= new Date(y, m, 0).getDate();
}

/** The numbers of a day or a moment — or null for nothing, or for something that is not one. */
function partsOf(value: Datish): Parts | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string") {
    // A DAY. Read as the day it says, never through a time zone.
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (day) {
      const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];

      return real(y, m, d) ? { y, m, d, hh: 0, mm: 0 } : null;
    }
  }

  const moment = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(moment.getTime())) return null;

  return { y: moment.getFullYear(), m: moment.getMonth() + 1, d: moment.getDate(), hh: moment.getHours(), mm: moment.getMinutes() };
}

function written(code: DateFormatCode, p: Parts, withYear: boolean): string {
  switch (code) {
    case "dmy":
      return withYear ? `${two(p.d)}/${two(p.m)}/${p.y}` : `${two(p.d)}/${two(p.m)}`;
    case "mdy":
      return withYear ? `${two(p.m)}/${two(p.d)}/${p.y}` : `${two(p.m)}/${two(p.d)}`;
    case "ymd":
      return withYear ? `${p.y}-${two(p.m)}-${two(p.d)}` : `${two(p.m)}-${two(p.d)}`;
    default:
      // No leading nought: "5 Oct 2026" is how it is said. Dates in numbers keep theirs.
      return withYear ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : `${p.d} ${MONTHS[p.m - 1]}`;
  }
}

const clock = (p: Parts) => `${p.hh % 12 === 0 ? 12 : p.hh % 12}:${two(p.mm)} ${p.hh < 12 ? "AM" : "PM"}`;

/** "12 Oct 2026" · "12/10/2026" · "10/12/2026" · "2026-10-12". Empty for no date. */
export function dateIn(code: DateFormatCode, value: Datish): string {
  const p = partsOf(value);

  return p ? written(code, p, true) : "";
}

/** The same day where the year goes without saying: "12 Oct" · "12/10" · "10/12" · "10-12". */
export function shortDateIn(code: DateFormatCode, value: Datish): string {
  const p = partsOf(value);

  return p ? written(code, p, false) : "";
}

/** The clock: "5:14 PM". */
export function timeOf(value: Datish): string {
  const p = partsOf(value);

  return p ? clock(p) : "";
}

/** A moment in full: "12 Oct 2026, 5:14 PM". */
export function dateTimeIn(code: DateFormatCode, value: Datish): string {
  const p = partsOf(value);

  return p ? `${written(code, p, true)}, ${clock(p)}` : "";
}

/** A moment this year: "12 Oct, 5:14 PM". */
export function shortDateTimeIn(code: DateFormatCode, value: Datish): string {
  const p = partsOf(value);

  return p ? `${written(code, p, false)}, ${clock(p)}` : "";
}

/** A month by name — "Oct", or "October". The same in every format: a name is not misread. */
export function monthName(value: Datish, long = false): string {
  const p = partsOf(value);

  return p ? (long ? MONTHS_LONG : MONTHS)[p.m - 1] : "";
}

/** "October 2026" — a statement's heading, a calendar's title. */
export function monthYear(value: Datish): string {
  const p = partsOf(value);

  return p ? `${MONTHS_LONG[p.m - 1]} ${p.y}` : "";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The day of the week — "Mon", or "Monday". A name, so the same in every format. */
export function weekdayOf(value: Datish, long = false): string {
  const p = partsOf(value);
  if (!p) return "";
  const name = WEEKDAYS[new Date(p.y, p.m - 1, p.d).getDay()];

  return long ? name : name.slice(0, 3);
}

/**
 * A day said out loud: "12 October 2026". For what is READ TO somebody — a
 * calendar cell's name for a screen reader — where no format is ambiguous
 * because every word is a word.
 */
export function spokenDate(value: Datish): string {
  const p = partsOf(value);

  return p ? `${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}` : "";
}

/**
 * WHAT SOMEBODY TYPED, as a day — or null when it is not one.
 *
 * A date field that only takes a calendar's clicks is slow for the person who
 * enters forty bills in a row and knows every date already. So the box takes
 * what a hand types: "12/10/2026", "12-10-26", "12.10", "12 oct", "oct 12
 * 2026", "12102026", "2026-10-12", "today".
 *
 * Two numbers with no month name are read in the SHOP's order — the day first,
 * unless the shop writes the month first. That is the only place the format
 * decides the meaning, and it decides it the way the shop reads.
 *
 * A year left off is this year; two digits are this century.
 */
export function typedDayIn(code: DateFormatCode, typed: string, today: Date = new Date()): string | null {
  const text = typed.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (text === "") return null;

  const day = (y: number, m: number, d: number) => (real(y, m, d) ? `${y}-${two(m)}-${two(d)}` : null);
  const year = (y: string | undefined) => (y === undefined ? today.getFullYear() : y.length <= 2 ? 2000 + Number(y) : Number(y));
  const shifted = (by: number) => {
    const then = new Date(today.getFullYear(), today.getMonth(), today.getDate() + by);

    return day(then.getFullYear(), then.getMonth() + 1, then.getDate());
  };

  if (text === "today" || text === "t") return shifted(0);
  if (text === "tomorrow") return shifted(1);
  if (text === "yesterday") return shifted(-1);

  // The year first: only ever one order.
  const ymd = /^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/.exec(text);
  if (ymd) return day(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  // A month by name: the number beside it is the day, whichever side it is on.
  const month = (word: string) => {
    const at = MONTHS.findIndex((m) => word.startsWith(m.toLowerCase()) && MONTHS_LONG[MONTHS.indexOf(m)].toLowerCase().startsWith(word));

    return at === -1 ? null : at + 1;
  };
  const dayThenName = /^(\d{1,2})[-/. ]?([a-z]{3,9})(?:[-/. ]?(\d{2}|\d{4}))?$/.exec(text);
  if (dayThenName) {
    const m = month(dayThenName[2]);

    return m === null ? null : day(year(dayThenName[3]), m, Number(dayThenName[1]));
  }
  const nameThenDay = /^([a-z]{3,9})[-/. ]?(\d{1,2})(?:[-/. ](\d{2}|\d{4}))?$/.exec(text);
  if (nameThenDay) {
    const m = month(nameThenDay[1]);

    return m === null ? null : day(year(nameThenDay[3]), m, Number(nameThenDay[2]));
  }

  // Two or three numbers, in the shop's order.
  let numbers = /^(\d{1,2})[-/. ](\d{1,2})(?:[-/. ](\d{2}|\d{4}))?$/.exec(text)?.slice(1) ?? null;
  // …or the same run with nothing between them: 12102026, 121026.
  if (numbers === null) {
    const run = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(text);
    if (run) numbers = run.slice(1);
  }
  if (numbers === null) return null;

  const [first, second, y] = numbers;
  const [d, m] = code === "mdy" ? [Number(second), Number(first)] : [Number(first), Number(second)];

  return day(year(y), m, d);
}

// ── This shop's way ─────────────────────────────────────────────────────
//
// Some three hundred places write a date: a row of a list, a chip on a filter,
// a line of a sheet, a tooltip. Most are plain functions, far from any hook.
// So the shop's choice is held HERE, once, the way its trading day is
// (common/shopDay.ts): told by the shop's settings when they arrive, and kept
// on the device so that the first screen of the next visit — drawn before the
// settings request has answered — is already written the right way.
//
// Nobody's shop (the console, the storefront, the sign-in page) is written the
// default way, which is the one that cannot be misread.

const KEY = "shopos-dates";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function recall(): DateFormatCode {
  try {
    return dateFormatOf(storage()?.getItem(KEY));
  } catch {
    return DEFAULT_DATE_FORMAT;
  }
}

let shops: DateFormatCode = recall();

/** Whether this device remembers a shop's choice at all — the default is not a memory of one. */
export function shopDateFormatIsRemembered(): boolean {
  try {
    return storage()?.getItem(KEY) != null;
  } catch {
    return false;
  }
}

/** How the shop on this device writes a date — what every function below writes with. */
export function shopDateFormat(): DateFormatCode {
  return shops;
}

/** Told by the shop's settings; null when nobody's shop is open, which forgets it. */
export function setShopDateFormat(next: DateFormatCode | null): void {
  const wanted = next ?? DEFAULT_DATE_FORMAT;
  if (wanted === shops && next !== null) return;
  shops = wanted;
  try {
    if (next === null) storage()?.removeItem(KEY);
    else storage()?.setItem(KEY, wanted);
  } catch {
    // A device that will not keep it still writes this visit correctly.
  }
}

/** "12 Oct 2026", the shop's way. */
export const shopDate = (value: Datish): string => dateIn(shops, value);
/** "12 Oct" — where the year goes without saying. */
export const shopShortDate = (value: Datish): string => shortDateIn(shops, value);
/** "12 Oct 2026, 5:14 PM" */
export const shopDateTime = (value: Datish): string => dateTimeIn(shops, value);
/** "12 Oct, 5:14 PM" */
export const shopShortDateTime = (value: Datish): string => shortDateTimeIn(shops, value);
