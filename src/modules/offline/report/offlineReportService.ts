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
    oldest: string | null;
    newest: string | null;
  };
  sales: OfflineSaleRow[];
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

