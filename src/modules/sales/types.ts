export type SaleChannel = "walk_in" | "pos" | "phone" | "whatsapp" | "online";
export type SaleStatus = "completed" | "partially_refunded" | "refunded" | "cancelled";
/**
 * Every tender a SALE can carry — the server's `PaymentMethod` enum, in full.
 *
 * `deposit` and `trade_in` were missing here while both were reachable on the
 * server: an advance settling a layaway, and an allowance covering a whole bill
 * at a tyre shop. Nothing broke, because the two screens that render a method
 * fall back gracefully (`.replace("_"," ")` and a label lookup with a default).
 *
 * It was a trap rather than a bug: a union that omits a real value tells the
 * next person writing an exhaustive `switch` that they have covered everything.
 * Found by listing every backend enum and asking which values the panel never
 * mentions — `trade_in` was the only one in the whole codebase.
 */
export type PaymentMethod =
  | "cash"
  | "card"
  | "bank_transfer"
  | "other"
  | "split"
  | "credit"
  | "deposit"
  | "trade_in";
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
  /**
   * The `OFF-…` number printed at the till when there was no server.
   *
   * Null on almost every sale. When it is set it is the ONLY number the
   * customer was given — the invoice number was assigned later, on sync — so
   * it is what they read out at the counter, and what the search matches.
   */
  offline_number?: string | null;
  branch_id?: string | null;
  branch?: { id: string; name: string } | null;
  channel: SaleChannel;
  status: SaleStatus;
  customer_name: string | null;
  customer_phone: string | null;
  order_type?: "dine_in" | "takeaway" | null;
  table_no?: string | null;
  /**
   * The kitchen docket this sale created, when it created one.
   *
   * Present only on the response to ringing a sale, and only for a takeaway a
   * kitchen actually has to make — the server builds the ticket after the money
   * is taken, so the till has no other way to learn it exists, and a slip it
   * cannot name is a slip it cannot print.
   */
  kitchen_ticket?: {
    ticket_id: string;
    ticket_number: string;
    /** One per station: the bar's docket is not the grill's. */
    kots: Array<{ id: string; kot_number: number; station: string | null }>;
  } | null;
  subtotal: string;
  discount: string;
  total: string;
  payment_method: PaymentMethod;
  amount_paid: string;
  /** How much of the bill was settled in goods rather than rupees. */
  trade_in_total?: string;
  trade_ins?: SaleTradeIn[];
  change_due: string;
  notes: string | null;
  sold_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  tax?: string;
  items?: SaleItem[];
  items_count?: number;
  returns?: SaleReturn[];
  /** Every leg of a split tender. Present when the sale was rung as a split. */
  payments?: Array<{ id: string; method: PaymentMethod; amount: string; reference: string | null }>;
  // Serialized retail: IMEI/serials captured on this sale (with warranty).
  serials?: SaleSerial[];
}

/** One serialized unit sold — IMEI/serial + its warranty window. */
export interface SaleSerial {
  id: string;
  product_name: string;
  serial: string;
  warranty_months: number | null;
  warranty_expires_at: string | null;
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
  /**
   * A line names ONE of these two, never both.
   *
   * `amount` is the money the customer handed over on a line where that is the
   * question — "do hazaar ka daal do" at a pump, "Rs 500 ka gosht" at a
   * butcher. The server divides by its OWN rate to get the quantity, so it is
   * not a price and cannot be used as one: a bigger amount buys more, never
   * the same amount cheaper.
   *
   * Only for items sold by weight/volume; the server refuses it on anything
   * sold by the unit.
   */
  quantity?: number;
  amount?: number;
  unit_price?: number;
  // Per-line POS discount: a fixed amount OR a percentage. Server prices the
  // line and applies/validates the discount (needs the discounts.apply perm).
  line_discount?: number;
  line_discount_pct?: number;
  modifier_option_ids?: string[];
}

export interface SaleTradeIn {
  id: string;
  product_id: string | null;
  product_name: string;
  description: string | null;
  quantity: string;
  unit_allowance: string;
  total_allowance: string;
  reversed_at: string | null;
}

export interface SaleInput {
  channel: SaleChannel;
  customer_name?: string;
  customer_phone?: string;
  order_type?: "dine_in" | "takeaway";
  table_no?: string;
  /**
   * Who SOLD it, which is not who rang it. Sent only where the shop asks; left
   * out rather than defaulted to the cashier, because a sale credited to the
   * till operator by default is what made the staff report wrong.
   */
  served_by?: string;
  items: SaleLineInput[];
  discount?: number;
  coupon_code?: string;
  // Loyalty: points the customer redeems (server converts to a discount).
  redeem_points?: number;
  tax?: number;
  // Single tender — required unless `payments` (a split) is sent.
  payment_method?: PaymentMethod;
  amount_paid?: number;
  // Multi-tender / split payment; when present it replaces the single tender.
  payments?: TenderInput[];
  /**
   * Goods taken in part-payment — the dead battery, the worn tyres.
   *
   * Note there is no amount: the allowance is quantity × unit_allowance and the
   * server computes it, then adds a `trade_in` tender of its own. A till that
   * could name its own trade-in amount could settle any bill with nothing
   * changing hands.
   */
  trade_ins?: Array<{
    product_id: string;
    quantity?: number;
    unit_allowance: number;
    description?: string;
    notes?: string;
  }>;
  notes?: string;
  // Pharmacy: prescription record captured for a sale of Rx-required items.
  prescription_number?: string;
  prescriber_name?: string;
  patient_name?: string;
  prescription_notes?: string;
  idempotency_key?: string;
  cash_session_id?: string | null;
}
