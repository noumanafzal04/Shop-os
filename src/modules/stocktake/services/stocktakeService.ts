import { apiDelete, apiGet, apiPost } from "../../../common/api/client";

/**
 * A stocktake: the shelves, counted, against what the system believed.
 *
 * The figure that matters is not the count — it is the VARIANCE and what it is
 * worth. A grocery losing 2% of its stock a month has no way to discover that
 * except by counting.
 */
export interface StockCount {
  id: string;
  reference: string;
  status: "counting" | "applied" | "cancelled";
  scope: "all" | "category";
  blind: boolean;
  lines_total: number;
  lines_counted: number;
  /** Written once, at apply. Null while the count is still open. */
  variance_units: string | number | null;
  variance_value: string | number | null;
  notes: string | null;
  started_at: string | null;
  applied_at: string | null;
  branch?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
  started_by?: { id: string; name: string } | string | null;
  applied_by?: { id: string; name: string } | string | null;
}

export interface StockCountLine {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  /** NULL means nobody counted this shelf — NOT that the shelf is empty. */
  counted_quantity: string | number | null;
  counted_at: string | null;
  /**
   * Absent while a BLIND count is open: a counter shown the expected figure
   * stops counting when they reach it.
   */
  expected_quantity?: string | number;
  unit_cost?: string | number;
  variance?: number | null;
  variance_value?: number | null;
}

export interface StockCountSummary {
  counted: number;
  matched: number;
  short_lines: number;
  over_lines: number;
  /** Kept apart, never netted — 10 short and 10 over is two mistakes, not none. */
  short_value: number;
  over_value: number;
  net_value: number;
  net_units: number;
}

export interface StockCountSheet {
  count: StockCount;
  items?: StockCountLine[];
  /** True while the expected figures are being withheld. */
  blind: boolean;
  summary: StockCountSummary | null;
}

export interface StartCountInput {
  scope?: "all" | "category";
  category_id?: string | null;
  blind?: boolean;
  notes?: string | null;
}

export const stocktakeService = {
  list: (params: { status?: string; page?: number } = {}) =>
    apiGet<StockCount[]>("/inventory/counts", { params }),

  current: () => apiGet<StockCount | null>("/inventory/counts/current"),

  start: (payload: StartCountInput) => apiPost<StockCount>("/inventory/counts", payload),

  sheet: (id: string, params: { search?: string; uncounted?: boolean } = {}) =>
    apiGet<StockCountSheet>(`/inventory/counts/${id}`, {
      params: { search: params.search || undefined, uncounted: params.uncounted ? 1 : undefined },
    }),

  /** Any subset of lines, in any order — counting happens in passes. */
  record: (id: string, lines: Array<{ item_id: string; counted_quantity: number | null }>) =>
    apiPost<StockCount>(`/inventory/counts/${id}/lines`, { lines }),

  apply: (id: string, notes?: string) => apiPost<StockCount>(`/inventory/counts/${id}/apply`, { notes }),

  cancel: (id: string) => apiDelete<StockCount>(`/inventory/counts/${id}`),
};
