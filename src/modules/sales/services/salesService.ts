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

/**
 * Every axis the ledger can be narrowed by.
 *
 * `channel`, `from` and `to` have been honoured by the server — and by its CSV
 * export — since the day both were written. The screen sent search and status.
 * So the export's own docblock promised "export this month's card sales" over
 * a screen with no way to say either word.
 */
export interface SaleFilters {
  search?: string;
  status?: string;
  channel?: string;
  /** cash / card / bank_transfer / credit / … — see PaymentMethod on the server. */
  payment_method?: string;
  /** Who rang it. Only meaningful where the shop asks. */
  served_by?: string;
  from?: string | null;
  to?: string | null;
  page?: number;
}

/** One place the filters become query parameters, so the list and the export
 *  can never send different ones. */
export function saleParams(params: SaleFilters): Record<string, string | number | undefined> {
  return {
    search: params.search || undefined,
    status: params.status || undefined,
    channel: params.channel || undefined,
    payment_method: params.payment_method || undefined,
    served_by: params.served_by || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    page: params.page ?? 1,
  };
}

export const salesService = {
  list: (params: SaleFilters) =>
    apiGet<Sale[]>("/sales", {
      params: saleParams(params),
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
