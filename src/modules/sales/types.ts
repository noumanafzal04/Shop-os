export type SaleChannel = "walk_in" | "pos" | "phone" | "whatsapp" | "online";
export type SaleStatus = "completed" | "partially_refunded" | "refunded" | "cancelled";
export type PaymentMethod = "cash" | "card" | "bank_transfer" | "other" | "split" | "credit";
/** A single tender in a split payment. */
export interface TenderInput {
  // 'credit' = sell-on-credit (khata) — goes onto the customer's balance.
  method: "cash" | "card" | "bank_transfer" | "other" | "credit";
  amount: number;
  reference?: string;
}

export interface SaleItem {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  unit_name?: string | null;
  unit_factor?: string | number;
  sku: string | null;
  item_type: "product" | "service";
  quantity: number;
  unit_price: string;
  unit_cost: string | null;
  line_total: string;
}

export interface Sale {
  id: string;
  invoice_number: string;
  branch_id?: string | null;
  branch?: { id: string; name: string } | null;
  channel: SaleChannel;
  status: SaleStatus;
  customer_name: string | null;
  customer_phone: string | null;
  order_type?: "dine_in" | "takeaway" | null;
  table_no?: string | null;
  subtotal: string;
  discount: string;
  total: string;
  payment_method: PaymentMethod;
  amount_paid: string;
  change_due: string;
  notes: string | null;
  sold_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  tax?: string;
  items?: SaleItem[];
  items_count?: number;
  returns?: SaleReturn[];
}

export interface SaleReturnItem {
  id: string;
  sale_item_id: string | null;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface SaleReturn {
  id: string;
  return_number: string;
  refund_total: string;
  refund_method: string;
  reason: string | null;
  returned_at: string;
  items?: SaleReturnItem[];
}

export interface SaleLineInput {
  product_id: string;
  variant_id?: string | null;
  // Pack-breaking: sell this line in a defined pack (strip/box) rather than
  // the base unit. Server converts to base units for stock + prices the pack.
  product_unit_id?: string | null;
  // Price level (price list): "wholesale" uses the product's wholesale price.
  price_level?: "retail" | "wholesale";
  quantity: number;
  unit_price?: number;
  // Per-line POS discount: a fixed amount OR a percentage. Server prices the
  // line and applies/validates the discount (needs the discounts.apply perm).
  line_discount?: number;
  line_discount_pct?: number;
  modifier_option_ids?: string[];
}

export interface SaleInput {
  channel: SaleChannel;
  customer_name?: string;
  customer_phone?: string;
  order_type?: "dine_in" | "takeaway";
  table_no?: string;
  items: SaleLineInput[];
  discount?: number;
  coupon_code?: string;
  tax?: number;
  // Single tender — required unless `payments` (a split) is sent.
  payment_method?: PaymentMethod;
  amount_paid?: number;
  // Multi-tender / split payment; when present it replaces the single tender.
  payments?: TenderInput[];
  notes?: string;
  // Pharmacy: prescription record captured for a sale of Rx-required items.
  prescription_number?: string;
  prescriber_name?: string;
  patient_name?: string;
  prescription_notes?: string;
  idempotency_key?: string;
  cash_session_id?: string | null;
}
