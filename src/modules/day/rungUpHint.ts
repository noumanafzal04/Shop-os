import type { DayView } from "./services/dayService";

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
