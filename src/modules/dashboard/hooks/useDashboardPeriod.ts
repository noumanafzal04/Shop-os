import { useCallback, useEffect, useMemo, useState } from "react";

import { useUrlFilters } from "../../../common/hooks/useUrlFilters";
import { shopToday } from "../../../common/shopDay";
import { fromIsoDate, type DateRange } from "../../../components/ui/filters";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * THE PERIOD SOMEBODY PINNED, if they pinned one.
 *
 * It lives in the address — `?from=…&to=…` — for the reason every filter on
 * this platform does: a link, a refresh and the back button all have to land
 * on the figures that were being read.
 *
 * ── The period a dashboard OPENS on is the absence of both ─────────────
 *
 * Not "today's date, written into the URL". A dashboard is left open on a
 * counter for days, and a date pinned on Friday is Friday for ever: on
 * Saturday morning the screen would still be titled by what the menu calls
 * "Yesterday". With nothing pinned the page follows the clock, and choosing
 * the opening period again from the menu UN-pins rather than pinning it — the
 * caller says which period that is, since the two consoles open differently.
 */
export function useDashboardPeriod(): {
  pinned: DateRange | null;
  /** Pin a period, or pass null to go back to following the clock. */
  pin: (period: DateRange | null) => void;
} {
  const { get, patch } = useUrlFilters();
  const from = get("from");
  const to = get("to");

  // Both or neither, and in order. A hand-edited address with one date, or
  // with the dates back to front, is not a period — it opens as usual rather
  // than asking the server for something it will refuse.
  const pinned = useMemo<DateRange | null>(
    () => (ISO.test(from) && ISO.test(to) && from <= to ? { from, to } : null),
    [from, to],
  );

  const pin = useCallback(
    (period: DateRange | null) => patch({ from: period?.from ?? null, to: period?.to ?? null }),
    [patch],
  );

  return { pinned, pin };
}

/**
 * The shop's business date, kept current while the page stays open.
 *
 * Read on every render — the shop's day rule arrives with its settings, a
 * moment after the first paint, and the date must follow it — and re-read
 * once a minute and whenever the tab is looked at again, so a dashboard left
 * on overnight is on the new day when the shutters go up. The Date it returns
 * is the same object until the date itself changes, so nothing downstream
 * re-asks the server for a minute passing.
 */
export function useShopToday(): Date {
  const [, look] = useState(0);

  useEffect(() => {
    const again = () => look((n) => n + 1);
    const timer = window.setInterval(again, 60_000);
    // Timers are throttled to nothing in a background tab; this is what
    // actually catches the morning.
    document.addEventListener("visibilitychange", again);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);

  const iso = shopToday();

  return useMemo(() => fromIsoDate(iso), [iso]);
}
