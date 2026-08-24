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

export interface AgeingBatch {
  id: string;
  product: { id: string; name: string; sku: string | null } | null;
  batch_number: string;
  dot_code: string | null;
  manufactured_on: string | null;
  quantity: number;
  /** "7 yr 2 mo" — computed server-side, because it changes every day. */
  age: string | null;
  age_status: "fresh" | "ageing" | "old" | null;
}

/**
 * Where a lot went when it left without being sold.
 *
 * The two dispositions must never be summed. `written_off` is money already
 * lost — it belongs in the year's expiry cost. `returned_to_supplier` is money
 * neither lost nor recovered, and only recovered if somebody chases it. Adding
 * them gives a loss figure overstated by everything the distributor is about to
 * pay back.
 */
export type Disposition = "written_off" | "returned_to_supplier";

export type DisposalReason = "expired" | "damaged" | "recall" | "other";

export interface BatchDisposalInput {
  disposition: Disposition;
  /** WHY it left — a different question from where it went. */
  reason: DisposalReason;
  notes?: string;
  /** A claim with nobody to claim from is not a claim. Required on a return. */
  supplier_id?: string;
  credit_expected?: number;
}

export interface StockDisposal {
  /**
   * Which branch this happened at, or null for an unpinned shop.
   *
   * The table has carried it since branches existed and the API returns it;
   * this type did not declare it, so it arrived and was dropped. See
   * `useBranchColumn`.
   */
  branch_id: string | null;
  id: string;
  number: string;
  product_name: string;
  batch_number: string | null;
  expiry_date: string | null;
  quantity: string;
  unit_cost: string | null;
  /** Null where the lot never carried a cost — unknown, which is not zero. */
  total_cost: string | null;
  disposition: Disposition;
  reason: DisposalReason;
  notes: string | null;
  supplier_id: string | null;
  supplier?: { id: string; name: string } | null;
  credit_expected: string | null;
  credit_received: string | null;
  credit_received_at: string | null;
  credit_reference: string | null;
  disposed_at: string;
  created_by_user?: { id: string; name: string } | null;
}

export interface DisposalFilters {
  disposition?: Disposition;
  reason?: DisposalReason;
  supplier_id?: string;
  /** Sent back, nothing credited — the list somebody works through. */
  awaiting_credit?: number;
  from?: string;
  to?: string;
  page?: number;
}

export interface StockMovement {
  /**
   * Which branch this happened at, or null for an unpinned shop.
   *
   * The table has carried it since branches existed and the API returns it;
   * this type did not declare it, so it arrived and was dropped. See
   * `useBranchColumn`.
   */
  branch_id: string | null;
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

  /**
   * Raise draft purchase orders straight off the reorder list.
   *
   * Ids only — the server decides the supplier, the quantity and the price from
   * the shop's own thresholds and purchase history, which is the only place
   * that knows who each item was last bought from.
   */
  orderReorderList: (productIds: string[]) =>
    apiPost<Array<{ id: string; supplier_id: string }>>(
      "/purchase-orders/from-reorder-list",
      { product_ids: productIds },
    ),

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
  /**
   * Take a lot off the shelf, and say where it went.
   *
   * An EMPTY lot is housekeeping and carries no disposition. A lot with stock
   * in it is an event — forty strips of medicine are binned or they go back to
   * the distributor, and those are opposite facts about the same money — so the
   * server refuses that one without an answer.
   */
  removeBatch: (id: string, disposal?: BatchDisposalInput) =>
    apiDelete<StockDisposal | null>(`/inventory/batches/${id}`, { data: disposal ?? {} }),

  /** Omit `days` to get the shop's own window — 90 for a pharmacy, 30 otherwise. */
  expiring: (days?: number) =>
    apiGet<ExpiringBatch[]>("/inventory/expiring", { params: days ? { days } : {} }),

  /**
   * Lots that have AGED past what this shop calls ageing — the other half of
   * the expiry sweep, and for years the missing half.
   *
   * `years` defaults to UNDEFINED so the server answers with the shop's own
   * threshold (Settings → POS → Stock ageing). Pass one only to ask a stricter
   * question than the shop's own policy, e.g. for a fleet contract.
   */
  ageing: (years?: number) =>
    apiGet<AgeingBatch[]>("/inventory/ageing", { params: years ? { years } : {} }),

  disposals: (params: DisposalFilters = {}) =>
    apiGet<StockDisposal[]>("/inventory/disposals", { params }),

  /**
   * The distributor settled a claim — for whatever they decided it was worth,
   * which is often less than was asked. What ARRIVED is recorded, never
   * assumed from what was claimed; the gap between the two is the figure worth
   * reading.
   */
  creditDisposal: (
    id: string,
    payload: { credit_received: number; credit_received_at: string; credit_reference?: string },
  ) => apiPost<StockDisposal>(`/inventory/disposals/${id}/credit`, payload),
};
