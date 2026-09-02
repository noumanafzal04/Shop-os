import { apiGet } from "../../../common/api/client";

/**
 * What happened while the shop was offline, as the server reports it.
 *
 * Split from the tab so the component file exports only a component —
 * a file that exports both loses fast refresh, which is a small tax paid
 * every time somebody edits the screen.
 */
interface OfflineSaleRow {
  id: string;
  invoice_number: string;
  offline_number: string | null;
  sold_at: string | null;
  synced_at: string | null;
  held_hours: number | null;
  total: number;
  till: string | null;
  register: string | null;
  violations: string[];
  beyond_window: boolean;
  /** Landed against a trading day the owner had already signed off. */
  after_close: boolean;
}

/**
 * A shift that was opened, run and counted with no server.
 *
 * Not a sale, and not summarised as one: opening a shift has invariants a sale
 * does not have — one open shift per lane, one per cashier — and a shift opened
 * offline can break them because the lane was taken by whoever got back online
 * first. The server records the conflict and corrects nothing, so this row is
 * the only place an owner ever learns of it.
 */
interface OfflineShiftRow {
  id: string;
  opened_at: string | null;
  synced_at: string | null;
  held_hours: number | null;
  /** False means a drawer nobody has counted — the one live item here. */
  closed: boolean;
  opening_float: number;
  counted_cash: number | null;
  variance: number | null;
  till: string | null;
  register: string | null;
  cashier: string | null;
  violations: string[];
}

interface OfflineReport {
  from: string;
  summary: {
    sales: number;
    total: number;
    flagged: number;
    beyond_window: number;
    /** How many landed against days already counted, closed and banked. */
    after_close: number;
    /**
     * What those were worth.
     *
     * The figure, not the count, is the one that matters: the books cannot
     * move — a day signed off in March has to read the same in September — so
     * this is exactly the amount by which those days' recorded takings now
     * fall short of their sales, and the only number an adjustment can be
     * written from.
     */
    after_close_total: number;
    /** Sales whose till had the wrong time by more than two minutes. */
    clock_off: number;
    /** Shifts, not sales — a different event with different rules. */
    shifts: number;
    shifts_flagged: number;
    oldest: string | null;
    newest: string | null;
  };
  sales: OfflineSaleRow[];
  shifts: OfflineShiftRow[];
  /**
   * Tills whose clock is wrong — one row each, not one per sale.
   *
   * A different question with a different owner from everything above it: the
   * moment was corrected before the sale was filed, so no figure in the books
   * is wrong. What is wrong is a piece of hardware, and the unit of the fix is
   * the tablet — one three days out produced forty sales and there is still
   * only one thing to do about it.
   */
  clocks: Array<{
    till: string | null;
    sales: number;
    /** Signed. Positive means the till was BEHIND. */
    skew_seconds: number;
  }>;
  oversold: Array<{
    product: string | null;
    sku: string | null;
    branch: string | null;
    quantity: number;
  }>;
}

export const offlineReportService = {
  load: () => apiGet<OfflineReport>("/reports/offline"),
};

