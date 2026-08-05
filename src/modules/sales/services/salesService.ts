import { apiGet, apiPost } from "../../../common/api/client";
import type { Sale, SaleInput, SaleReturn } from "../types";

/** Mirrors Sale::VOID_REASONS on the server. */
export const VOID_REASONS = [
  { value: "wrong_item", label: "Wrong item rung" },
  { value: "customer_changed_mind", label: "Customer changed their mind" },
  { value: "price_error", label: "Price error" },
  { value: "duplicate", label: "Duplicate sale" },
  { value: "test_sale", label: "Test sale" },
  { value: "other", label: "Other" },
] as const;

export type VoidReasonCode = (typeof VOID_REASONS)[number]["value"];

export const salesService = {
  list: (params: { search?: string; status?: string; page?: number }) =>
    apiGet<Sale[]>("/sales", {
      params: {
        search: params.search || undefined,
        status: params.status || undefined,
        page: params.page ?? 1,
      },
    }),

  show: (id: string) => apiGet<Sale>(`/sales/${id}`),

  create: (payload: SaleInput) => apiPost<Sale>("/sales", payload),

  /**
   * A void needs a CODED reason — free text alone can't be tallied, and the
   * void report per cashier is the control that catches a ring-and-void.
   */
  cancel: (id: string, reason_code: VoidReasonCode, reason?: string) =>
    apiPost<Sale>(`/sales/${id}/cancel`, { reason_code, reason }),

  processReturn: (
    id: string,
    payload: {
      items: Array<{ sale_item_id: string; quantity: number }>;
      reason?: string;
      refund_method?: string;
      /** Replay guard — a retried/double-clicked partial return must not
       *  refund cash twice. Same key returns the original refund. */
      idempotency_key?: string;
    },
  ) => apiPost<SaleReturn>(`/sales/${id}/returns`, payload),

  exchange: (
    id: string,
    payload: {
      return_items: Array<{ sale_item_id: string; quantity: number }>;
      items: Array<{ product_id: string; quantity: number; variant_id?: string | null }>;
      payments?: Array<{ method: string; amount: number }>;
      channel?: string;
      reason?: string;
    },
  ) => apiPost<{ return: SaleReturn; sale: Sale; difference: number }>(`/sales/${id}/exchange`, payload),

  // Receipts live in modules/receipts: printing one is logged as an original
  // or a stamped copy, so it is never just "fetch the invoice HTML".
};
