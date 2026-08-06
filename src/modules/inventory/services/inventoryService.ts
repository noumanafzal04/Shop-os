import { apiDelete, apiGet, apiPatch, apiPost } from "../../../common/api/client";
import type { Product } from "../../catalog/types";

export interface ProductBatch {
  id: string;
  product_id: string;
  batch_number: string;
  /** A fence: a medicine past it may not be dispensed. */
  expiry_date: string | null;
  /**
   * An AGE, not a fence. From a tyre's DOT code — 2224 is week 22 of 2024.
   * Rubber ages sitting still, so the shop needs to see how old a lot is and
   * sell the oldest first. Nothing is ever blocked on it.
   */
  dot_code?: string | null;
  manufactured_on?: string | null;
  /** Computed server-side; changes every day on its own. */
  age?: string | null;
  age_status?: "fresh" | "ageing" | "old" | null;
  quantity: number | string;
  cost: number | string | null;
}

export interface ExpiringBatch {
  id: string;
  product: { id: string; name: string; sku: string | null } | null;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
  expired: boolean;
}

export interface StockMovement {
  id: string;
  product_id: string;
  variant_id: string | null;
  type: "in" | "out" | "set";
  quantity_change: number;
  quantity_after: number;
  reason: string | null;
  created_at: string;
  product?: { id: string; name: string };
  variant?: { id: string; name: string } | null;
}

export interface AdjustPayload {
  product_id: string;
  variant_id?: string | null;
  type: "in" | "out" | "set";
  quantity?: number;
  new_quantity?: number;
  reason?: string;
  idempotency_key?: string;
}

export const inventoryService = {
  adjust: (payload: AdjustPayload) => apiPost<StockMovement>("/inventory/adjust", payload),

  movements: (params: { product_id?: string; page?: number }) =>
    apiGet<StockMovement[]>("/inventory/movements", {
      params: { product_id: params.product_id || undefined, page: params.page ?? 1 },
    }),

  lowStock: () => apiGet<Product[]>("/inventory/low-stock"),

  batches: (productId: string) => apiGet<ProductBatch[]>(`/inventory/products/${productId}/batches`),
  addBatch: (
    productId: string,
    payload: {
      batch_number: string;
      expiry_date?: string;
      /** Four digits off a tyre's sidewall: 2224 = week 22 of 2024. */
      dot_code?: string;
      manufactured_on?: string;
      quantity: number;
      cost?: number;
    },
  ) =>
    apiPost<ProductBatch>(`/inventory/products/${productId}/batches`, payload),
  updateBatch: (
    id: string,
    payload: { batch_number?: string; expiry_date?: string | null; dot_code?: string | null; manufactured_on?: string | null },
  ) =>
    apiPatch<ProductBatch>(`/inventory/batches/${id}`, payload),
  removeBatch: (id: string) => apiDelete<null>(`/inventory/batches/${id}`),
  expiring: (days = 30) => apiGet<ExpiringBatch[]>("/inventory/expiring", { params: { days } }),
};
