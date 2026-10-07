/**
 * WHICH DAY IT IS — IN THE SHOP, NOT IN THE BROWSER.
 *
 * ── What was wrong ───────────────────────────────────────────────────
 *
 * Every "Today" in the panel was the date on the device: midnight to
 * midnight, by the browser's clock. Every "today" on the server was a UTC
 * day, which in Karachi runs from five in the morning to five in the morning.
 * Between midnight and five the two were different dates, so a restaurant
 * still serving pressed "Today" on its sales list at one o'clock and was
 * shown nothing — the panel had asked for a day the server said had not
 * begun, while the dashboard beside it was still adding to the evening.
 *
 * ── The rule ─────────────────────────────────────────────────────────
 *
 * A shop's day TURNS AT AN HOUR, by its own clock: five in the morning
 * unless the shop has chosen another (Settings → Shop). The server owns the
 * rule (`App\Support\ShopDay`) and sends it with the shop's settings; this
 * file is the same arithmetic, so a "Today" button asks for the day the
 * server will answer with.
 *
 * It is worked out HERE rather than fetched because it changes while the
 * page is open — a till left on overnight crosses the turn without a request
 * — and because a date filter cannot wait for one.
 *
 * ── Who has no shop ──────────────────────────────────────────────────
 *
 * The platform console and a customer are not standing in any shop. With no
 * rule set, today is the device's own date, as it always was for them.
 */

export interface ShopDayRule {
  /** IANA zone of the shop's wall clock, e.g. "Asia/Karachi". */
  zone: string;
  /** Minutes after midnight, on that clock, at which the day turns. */
  turnsAtMinutes: number;
}

/** New key. The existing ones are never renamed — see brandName.test.ts. */
const KEY = "shopos-day";

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const valid = (rule: unknown): rule is ShopDayRule => {
  const r = rule as ShopDayRule | null;

  return !!r && typeof r.zone === "string" && r.zone !== ""
    && Number.isFinite(r.turnsAtMinutes) && r.turnsAtMinutes >= 0 && r.turnsAtMinutes < 24 * 60;
};

function recall(): ShopDayRule | null {
  try {
    const raw = storage()?.getItem(KEY);
    const rule = raw ? (JSON.parse(raw) as unknown) : null;

    return valid(rule) ? rule : null;
  } catch {
    return null;
  }
}

// Kept on the device so the FIRST filter of a session — drawn before the
// settings request has answered — already asks for the right day.
let rule: ShopDayRule | null = recall();

/** Told by the shop's settings when they arrive; null when nobody's shop is open. */
export function setShopDayRule(next: ShopDayRule | null): void {
  const wanted = next !== null && valid(next) ? next : null;
  // Told by every screen that reads the settings; written once.
  if (wanted?.zone === rule?.zone && wanted?.turnsAtMinutes === rule?.turnsAtMinutes) return;
  rule = wanted;
  try {
    if (rule) storage()?.setItem(KEY, JSON.stringify(rule));
    else storage()?.removeItem(KEY);
  } catch {
    // Full or blocked: the rule still holds for this page.
  }
}

const pad = (n: number): string => `${n}`.padStart(2, "0");

/** `yyyy-mm-dd` on the device's own clock — the answer when there is no shop. */
const deviceDate = (moment: Date): string =>
  `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;

/** `yyyy-mm-dd` of a moment read on a named clock. */
function dateIn(zone: string, moment: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(moment);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";

    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    // A zone this browser has never heard of. The device's date is a better
    // answer than a crash on every screen with a date filter.
    return deviceDate(moment);
  }
}

/**
 * The BUSINESS date a moment belongs to in this shop.
 *
 * One in the morning is still the evening it follows, until the day turns.
 */
export function shopDateOf(moment: Date, using: ShopDayRule | null = rule): string {
  if (using === null) return deviceDate(moment);

  return dateIn(using.zone, new Date(moment.getTime() - using.turnsAtMinutes * 60_000));
}

/** The business date it is now — what "Today" on a report means. */
export function shopToday(now: Date = new Date()): string {
  return shopDateOf(now);
}

/**
 * The date on the shop's WALL — the newest date somebody may type on a bill.
 *
 * Later than `shopToday()` for the hours between midnight and the turn.
 */
export function shopWallToday(now: Date = new Date()): string {
  return rule === null ? deviceDate(now) : dateIn(rule.zone, now);
}

/**
 * `shopToday()` as a Date whose LOCAL parts are that date.
 *
 * For range arithmetic ("last 7 days", "this month"), which is done on local
 * Y/M/D parts so that it never passes through UTC.
 */
export function shopTodayDate(now: Date = new Date()): Date {
  const [year, month, day] = shopToday(now).split("-").map(Number);

  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/** Minutes a named clock is ahead of UTC right now (behind is negative). */
export function zoneOffsetMinutes(zone: string, at: Date = new Date()): number {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
    const found = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!found) return 0;                       // "GMT" itself

    return (found[1] === "-" ? -1 : 1) * (Number(found[2]) * 60 + Number(found[3] ?? 0));
  } catch {
    return 0;
  }
}

/**
 * Where a shop's day turns when it has NOT chosen an hour.
 *
 * The server's rule, restated (`ShopDay::frame`): where it has always turned
 * — midnight UTC, read on the shop's own clock — when that falls in the small
 * hours; otherwise the shop's own midnight. Five in the morning in Pakistan.
 * Only so the settings screen can NAME the default; the rule itself always
 * comes from the server.
 */
export function usualTurnMinutes(zone: string, at: Date = new Date()): number {
  const offset = zoneOffsetMinutes(zone, at);

  return offset >= 0 && offset <= 8 * 60 ? offset : 0;
}

/** "5:00 am" — the hour the day turns, for a sentence on a screen. */
export function turnsAtLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (hour === 0 && minute === 0) return "midnight";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;

  return `${twelve}${minute === 0 ? "" : `:${pad(minute)}`} ${hour < 12 ? "am" : "pm"}`;
}

/**
 * The hours a shop may choose for its day to turn at, for a dropdown.
 *
 * "The usual" hands the choice back to the server (value "usual", stored as
 * null) and SAYS what that currently is — five in the morning in Pakistan —
 * because a default nobody can see is a default nobody can check.
 */
export function turnHourChoices(zone: string): Array<{ value: string; label: string }> {
  return [
    { value: "usual", label: `The usual — ${turnsAtLabel(usualTurnMinutes(zone))}` },
    { value: "0", label: "Midnight" },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((hour) => ({ value: String(hour), label: turnsAtLabel(hour * 60) })),
  ];
}
