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

/** The movement types a cashier may record from the till. */
export type ManualMovementType = "paid_in" | "paid_out" | "drop" | "float_add" | "no_sale";

/**
 * Every movement type the drawer can show. The system ones are written by the
 * flow that actually moved the money (a khata settled, a supplier paid from the
 * till, a voided cash sale handed back) — the POS renders them but never posts
 * them.
 */
export type CashMovementType =
  | ManualMovementType
  | "khata_in"
  | "supplier_out"
  | "expense_out"
  | "void_refund";

export interface CashMovement {
  id: string;
  type: CashMovementType;
  // The server's own reading of which way the drawer moved — "none" is a
  // no-sale, an event with no amount.
  direction: "in" | "out" | "none";
  amount: string | number;
  reason: string | null;
  note: string | null;
  user?: { id: string; name: string } | null;
  created_at: string | null;
}

/**
 * The X-read totals (App\Support\DrawerMath) — the ONE place the server decides
 * what a drawer should hold, so the mid-shift read and the close-and-count can
 * never disagree. The chain the UI renders:
 *
 *   cash_sales    = cash_tendered − change_given − cash_refunds
 *   expected_cash = opening_float + cash_sales + cash_in − cash_out
 */
export interface DrawerTotals {
  cash_tendered: number;
  change_given: number;
  cash_refunds: number;
  cash_in: number;
  cash_out: number;
  cash_sales: number;
  expected_cash: number;
  sales_count: number;
  sales_total: number;
  discounts: number;
  tax: number;
  voids: number;
  refunds: number;
  /** Keyed by tender method: cash, card, bank_transfer, credit… */
  tender_mix: Record<string, number>;
}

export interface SessionReport {
  session: CashSession;
  /**
   * Under blind close `expected_cash` and `cash_sales` are ABSENT, not zero —
   * the cashier is not shown the number they are about to be measured
   * against. Everything they actually did stays visible.
   */
  drawer: Omit<DrawerTotals, "expected_cash" | "cash_sales"> & {
    expected_cash?: number;
    cash_sales?: number;
  };
  blind_close: boolean;
  denomination_count: boolean;
  declare_tenders: boolean;
  /** Notes and coins to offer, largest first. */
  denominations: number[];
  movements: CashMovement[];
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

  /**
   * The counter's own shortlist — what this branch actually sells, with
   * un-scannable items first. Derived on the server; nobody maintains it, and
   * a shop with no trade yet gets an empty list and no strip.
   */
  quickKeys: () => apiGet<Product[]>("/pos/quick-keys"),

  currentSession: () => apiGet<CashSession | null>("/pos/session"),
  // The lane may be named explicitly (the picker) or left to the terminal's
  // own X-Register-Id header. Re-opening the lane you already hold RESUMES it.
  openSession: (opening_float: number, register_id?: string | null) =>
    apiPost<CashSession>("/pos/session/open", register_id ? { opening_float, register_id } : { opening_float }),
  // Handover: carry an open drawer to another lane when a terminal dies or the
  // shop closes the far lanes for the evening.
  moveSession: (register_id: string) => apiPost<CashSession>("/pos/session/move", { register_id }),
  closeSession: (payload: {
    counted_cash: number;
    notes?: string;
    /** {5000: 3, 1000: 12, …}. When present it DERIVES the total server-side. */
    denominations?: Record<string, number>;
    /** What the cashier says each non-cash tender took. */
    declared_tenders?: Record<string, number>;
  }) => apiPost<CashSession>("/pos/session/close", payload),

  // The live X-read. 409 SHIFT_NOT_OPEN when the caller holds no drawer, so
  // only ask once a shift is known to be open.
  sessionReport: () => apiGet<SessionReport>("/pos/session/report"),
  movements: () => apiGet<CashMovement[]>("/pos/session/movements"),
  // Cashier-initiated only; the server resolves the drawer from the caller, so
  // a movement can never be posted into someone else's till.
  recordMovement: (payload: { type: ManualMovementType; amount?: number; reason?: string; note?: string }) =>
    apiPost<CashMovement>("/pos/session/movements", payload),

  heldList: () => apiGet<HeldSale[]>("/pos/held"),
  hold: (payload: { label?: string; cart: HeldSale["cart"]; total_estimate: number }) =>
    apiPost<HeldSale>("/pos/held", payload),
  // CLAIM, not load-then-delete: exactly one lane may resume a parked ticket,
  // or two cashiers ring the same basket and the shop ships it twice.
  claimHeld: (id: string) => apiPost<HeldSale>(`/pos/held/${id}/claim`),
  deleteHeld: (id: string) => apiDelete<null>(`/pos/held/${id}`),
};
