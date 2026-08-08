/**
 * The window a report covers.
 *
 * The server has always accepted `period=custom&from=&to=` (ReportController
 * validates it, ReportService::resolvePeriod resolves it) and the panel has
 * never offered it — four fixed buttons and no way to ask for "1 to 15 March".
 * A books-only business closes its month against a range somebody else chose,
 * not against a calendar month, so this is the one report control that is not
 * a nicety.
 *
 * The dates are resolved HERE as well as on the server, for two reasons that
 * both bite:
 *
 *   The header has to say what window it is showing before the first response
 *   lands, or the period buttons change and the dates under them lag a request
 *   behind.
 *
 *   Not every report takes a `period`. The receipt-copies report takes a plain
 *   from/to, and it used to derive its own range from the period string with
 *   its own arithmetic — which started the week on SUNDAY while the server
 *   started it on Monday. Two tabs of the same screen, one day apart, and
 *   nothing on either saying so.
 *
 * So this mirrors App\Services\ReportService::resolvePeriod exactly, and is
 * tested against the cases where the two could drift.
 */

export type PeriodKey = "daily" | "weekly" | "monthly" | "yearly" | "custom";

/** What the report screen asks for: a named window, or two dates. */
export interface ReportRange {
  period: PeriodKey;
  from: string;
  to: string;
}

export const PERIODS: Array<[PeriodKey, string]> = [
  ["daily", "Today"],
  ["weekly", "This Week"],
  ["monthly", "This Month"],
  ["yearly", "This Year"],
  ["custom", "Custom range"],
];

/** A local YYYY-MM-DD. `toISOString` would shift a Karachi evening to yesterday. */
export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The from/to a named period stands for. Weeks start MONDAY, because that is
 * what Carbon does on the server and a report that disagrees with itself by
 * one day is worse than one that picks the wrong day consistently.
 */
export function resolveReportRange(
  period: PeriodKey,
  from?: string,
  to?: string,
  today = new Date(),
): ReportRange {
  const y = today.getFullYear();
  const m = today.getMonth();

  switch (period) {
    case "daily":
      return { period, from: iso(today), to: iso(today) };

    case "weekly": {
      // getDay() is 0 for Sunday; Monday-based offset puts Sunday at the END.
      const offset = (today.getDay() + 6) % 7;
      const start = new Date(y, m, today.getDate() - offset);
      const end = new Date(y, m, today.getDate() - offset + 6);

      return { period, from: iso(start), to: iso(end) };
    }

    case "monthly":
      return { period, from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };

    case "yearly":
      return { period, from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };

    default:
      // The server's own fallback: start of this month → today.
      return {
        period: "custom",
        from: from || iso(new Date(y, m, 1)),
        to: to || iso(today),
      };
  }
}

/**
 * The query params for a report request.
 *
 * `from`/`to` ride along even for a named period. The server ignores them
 * there (the named arms are computed, not read), and sending them keeps one
 * shape for every report call rather than two that drift.
 */
export function rangeParams(range: ReportRange): { period: string; from: string; to: string } {
  return { period: range.period, from: range.from, to: range.to };
}

/**
 * Why a custom range cannot be asked for yet, or null when it can.
 * Mirrors the server's `after_or_equal:from`, so the same range is refused in
 * the same words rather than costing a round trip to find out.
 */
export function rangeError(range: ReportRange): string | null {
  if (range.period !== "custom") return null;
  if (!range.from || !range.to) return "Choose both dates.";
  if (range.to < range.from) return "The end date must be on or after the start date.";

  return null;
}
