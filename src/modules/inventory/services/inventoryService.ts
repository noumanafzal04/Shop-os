import { apiGet, apiPost } from "../../../common/api/client";

export interface StockMovement {
  id: string;
  product_id: string;
  variant_id: string | null;
  type: "in" | "out" | "set";
  quantity_change: number;
  quantity_after: number;
  reason: string | null;
  created_at: string;
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

  movements: (params: { product_id?: string }) =>
    apiGet<StockMovement[]>("/inventory/movements", {
      params: { product_id: params.product_id || undefined },
    }),
};
