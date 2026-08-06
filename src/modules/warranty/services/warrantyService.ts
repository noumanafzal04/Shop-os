import { apiGet, apiPost } from "../../../common/api/client";

/** How a claim ends. `rejected` is a real outcome, not a failure to resolve. */
export const RESOLUTIONS = [
  { value: "repaired", label: "Repaired" },
  { value: "replaced", label: "Replaced" },
  { value: "refunded", label: "Refunded" },
  { value: "rejected", label: "Rejected" },
] as const;

/**
 * A unit somebody brought back.
 *
 * `resolution === null` IS the open state — the shop is still holding it. There
 * is no separate status field to disagree with this one.
 */
export interface WarrantyClaim {
  id: string;
  serial: string;
  product_name: string;
  fault: string;
  customer_name: string | null;
  customer_phone: string | null;
  /** Frozen on the day it came in, never recomputed. */
  was_under_warranty: boolean;
  warranty_expires_at: string | null;
  resolution: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolver?: { id: string; name: string } | null;
  creator?: { id: string; name: string } | null;
  created_at: string;
}

/** A serial/IMEI lookup result — what was sold, when, and its warranty state. */
export interface WarrantyRecord {
  serial: string;
  product_name: string;
  sold_at: string | null;
  warranty_months: number | null;
  warranty_expires_at: string | null;
  under_warranty: boolean;
  days_left: number;
  sale: {
    id: string;
    invoice_number: string;
    status: string;
    customer_name: string | null;
    customer_phone: string | null;
    total: string | number;
  } | null;
  /** Every time this exact unit has been back before. */
  claims: WarrantyClaim[];
}

export const warrantyService = {
  // Look up a serial / IMEI at the warranty desk.
  lookup: (serial: string) =>
    apiGet<WarrantyRecord>("/warranty/lookup", { params: { serial } }),

  /** What the shop is holding. Open claims first, oldest first. */
  claims: (params: { status?: "open" | "resolved" | "all"; search?: string; page?: number } = {}) =>
    apiGet<WarrantyClaim[]>("/warranty/claims", { params }),

  /** Take the unit in. No money moves and no stock moves — it is not a return. */
  book: (payload: { serial: string; fault: string; customer_name?: string; customer_phone?: string }) =>
    apiPost<WarrantyClaim>("/warranty/claims", payload),

  /** Say what happened to it. Once only. */
  resolve: (id: string, payload: { resolution: string; note?: string }) =>
    apiPost<WarrantyClaim>(`/warranty/claims/${id}/resolve`, payload),
};
