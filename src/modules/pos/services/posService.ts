import { apiDelete, apiGet, apiPost } from "../../../common/api/client";
import type { Product } from "../../catalog/types";

export interface CashSession {
  id: string;
  status: "open" | "closed";
  opening_float: string | number;
  cash_sales: string | number;
  expected_cash: string | number | null;
  counted_cash: string | number | null;
  variance: string | number | null;
  sales_count: number;
  sales_total: string | number;
  opened_at: string;
  closed_at: string | null;
  register_id?: string | null;
  register?: { id: string; name: string; code: string | null } | null;
}

export interface HeldSale {
  id: string;
  label: string | null;
  total_estimate: string | number;
  // The full ticket state so resume restores EXACTLY what was parked —
  // dine-in table, customer contact, tax, and applied coupon included.
  cart: {
    items: HeldCartLine[];
    customer_name?: string;
    customer_phone?: string;
    discount?: number;
    tax?: string;
    order_type?: "takeaway" | "dine_in";
    table_no?: string;
    coupon_code?: string | null;
    payment_method?: "cash" | "card";
  };
  created_at: string;
  register_id?: string | null;
  user?: { id: string; name: string } | null;
  register?: { id: string; name: string; code: string | null } | null;
}

export interface HeldCartLine {
  product_id: string;
  variant_id?: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  // Pack-breaking: which pack this parked line was in (restored on resume).
  product_unit_id?: string | null;
  unit_name?: string | null;
  unit_factor?: number;
  discountValue?: number;
  discountMode?: "amt" | "pct";
  modifier_option_ids?: string[];
  modifiers_label?: string;
}

export const posService = {
  lookup: (code: string) =>
    apiGet<{
      product: Product;
      variant_id: string | null;
      product_unit_id?: string | null;
      requires_prescription: boolean;
      near_expiry: { batch_number: string; expiry_date: string; days: number } | null;
      // Present only when the scanned code was a scale (embedded-weight)
      // barcode: the pre-filled weighed quantity to add.
      scale?: {
        mode: "weight" | "price";
        quantity: number;
        weight: number | null;
        embedded_price: number | null;
      };
    }>("/pos/lookup", { params: { code } }),

  currentSession: () => apiGet<CashSession | null>("/pos/session"),
  // The lane may be named explicitly (the picker) or left to the terminal's
  // own X-Register-Id header. Re-opening the lane you already hold RESUMES it.
  openSession: (opening_float: number, register_id?: string | null) =>
    apiPost<CashSession>("/pos/session/open", register_id ? { opening_float, register_id } : { opening_float }),
  // Handover: carry an open drawer to another lane when a terminal dies or the
  // shop closes the far lanes for the evening.
  moveSession: (register_id: string) => apiPost<CashSession>("/pos/session/move", { register_id }),
  closeSession: (counted_cash: number, notes?: string) =>
    apiPost<CashSession>("/pos/session/close", { counted_cash, notes }),

  heldList: () => apiGet<HeldSale[]>("/pos/held"),
  hold: (payload: { label?: string; cart: HeldSale["cart"]; total_estimate: number }) =>
    apiPost<HeldSale>("/pos/held", payload),
  // CLAIM, not load-then-delete: exactly one lane may resume a parked ticket,
  // or two cashiers ring the same basket and the shop ships it twice.
  claimHeld: (id: string) => apiPost<HeldSale>(`/pos/held/${id}/claim`),
  deleteHeld: (id: string) => apiDelete<null>(`/pos/held/${id}`),
};
