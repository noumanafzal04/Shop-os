import { useMemo, useState } from "react";

import type { RangeKey } from "../../../components/ui/filters";
import { PERIODS, rangeError, resolveReportRange, type PeriodKey, type ReportRange } from "../reportPeriod";

/**
 * The rolling windows a report screen wants and the shop's own named periods
 * do not cover.
 *
 * `today`, `this_month`, `this_year` and `this_quarter` are left out because
 * PERIODS already names three of them and the fourth is close enough to read
 * as a duplicate — and a menu with two rows for one range cannot be trusted
 * about either.
 */
export const REPORT_PRESETS: readonly RangeKey[] = ["yesterday", "last_7", "last_14", "last_30", "last_month"];

/**
 * THE WINDOW A MONEY SCREEN IS LOOKING THROUGH — held once, for every screen
 * that sums over dates.
 *
 * It lived inside the Reports page, and the Cashbook beside it kept four
 * buttons of its own: Today, This week, This month, This year. So the screen a
 * books-only business opens every morning could not be asked about last
 * month, about 1 to 15, or about the tax year — the three windows its
 * accountant actually works in — while the Reports tab next door could.
 *
 * The window is two dates. The period NAME is worked out from them, so the
 * request still carries a period the server recognises and "custom" when the
 * pair is nobody's.
 */
export function useReportWindow(opensOn: PeriodKey = "monthly") {
  const [range, setRange] = useState<{ from: string; to: string }>(() => {
    const seed = resolveReportRange(opensOn);

    return { from: seed.from, to: seed.to };
  });

  /**
   * The shop's own named windows, resolved once, handed to the date control.
   *
   * "Custom range" is deliberately absent: the control has its own, and a row
   * that opens the same dialog twice under two names is a menu nobody trusts.
   */
  const namedPeriods = useMemo(
    () =>
      PERIODS.filter(([key]) => key !== "custom").map(([key, label]) => {
        const resolved = resolveReportRange(key);

        return { key, label, range: { from: resolved.from, to: resolved.to } };
      }),
    [],
  );

  // Whichever named window this pair of dates IS, so the request still carries
  // a period the server recognises — and "custom" when it is nobody's.
  const period: PeriodKey =
    (namedPeriods.find((p) => p.range.from === range.from && p.range.to === range.to)?.key as PeriodKey | undefined)
    ?? "custom";

  const asked: ReportRange = { period, from: range.from, to: range.to };
  // Refused in the server's own words rather than after a round trip. The
  // control cannot produce a backwards range — it orders the two ends itself —
  // so this now only fires on a half-open one.
  const invalid = rangeError(asked);

  return {
    range,
    setRange,
    namedPeriods,
    /** What the person asked for. */
    asked,
    /** Why it cannot be sent yet, or null. */
    invalid,
    /**
     * What to SEND. A half-open range is never sent, so the figures on screen
     * never briefly answer a question nobody asked.
     */
    sent: invalid ? resolveReportRange("monthly") : asked,
  };
}
