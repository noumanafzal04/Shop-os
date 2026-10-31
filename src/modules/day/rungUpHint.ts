import type { DayView, TakenWithNoDrawer } from "./services/dayService";

/**
 * WHAT "RUNG UP" IS MADE OF (B14).
 *
 * The day's takings include sales no drawer took — an order paid on the
 * doorstep, a sale with no shift open — and the drawers beside it do not. Said
 * under the figure, so the 500 "Rung up" is not read against 300 in the drawers
 * as 200 gone missing.
 */
export function rungUpHint(running: Pick<DayView["running"], "sales_count" | "away_from_drawers">): string {
  const sales = `${running.sales_count} sale${running.sales_count === 1 ? "" : "s"}`;
  const away = running.away_from_drawers?.sales_count ?? 0;

  return away > 0 ? `${sales} · ${away} not at a counter` : sales;
}

/**
 * A BOOKING'S CASH THAT NO DRAWER TOOK OR GAVE (#AZ21).
 *
 * A layaway's advance taken with no shift open, and the cash handed back when
 * one was cancelled with none open: real notes, in the books, and in no till's
 * count. Said beside the drawers — never added into them — so the shop can see
 * where they went. Null when there is none.
 */
export function bookingCashAway(away: TakenWithNoDrawer | null | undefined, money: (n: number) => string): string | null {
  const taken = away?.advances_in ?? 0;
  const back = away?.advances_back ?? 0;
  if (taken <= 0 && back <= 0) return null;

  const parts = [taken > 0 ? `${money(taken)} cash taken` : null, back > 0 ? `${money(back)} cash handed back` : null].filter(Boolean);

  return `On bookings with no drawer open: ${parts.join(" · ")}. It is in your books and in no till's count — open a shift first to have it counted.`;
}
