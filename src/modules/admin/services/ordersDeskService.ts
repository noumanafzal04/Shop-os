import { apiGet, apiPost, apiPut } from "../../../common/api/client";

/**
 * THE ORDERS DESK — the marketplace's open orders as they happen, customers'
 * problems with them, and the delivery rules every shop follows unless it set
 * its own. One permission (`orders.oversee`), one screen, three tabs.
 */

export interface DeliveryRules {
  default_min_order: number | null;
  below_minimum: "fee" | "refuse";
  delivery_fee_per_km: number | null;
  delivery_fee_base_km: number;
  service_fee: number;
  rush_fee: number;
  rush_fee_on: boolean;
  accept_within_minutes: number;
  rider_cash_limit: number | null;
}

export type LiveFlag = "shop_slow" | "no_rider" | "transfer_unchecked" | "late";

export interface LiveOrder {
  id: string;
  order_number: string;
  status: string;
  fulfillment_type: "delivery" | "pickup";
  payment_method: string;
  total: string;
  customer_name: string;
  customer_phone: string | null;
  delivery_address: string | null;
  placed_at: string | null;
  minutes: number;
  shop: { id: string; business_name: string; slug: string; phone: string | null } | null;
  rider: { name: string; phone: string | null; accepted: boolean } | null;
  flags: LiveFlag[];
}

export interface LiveBoard {
  orders: LiveOrder[];
  /** The shops with something open — the shop filter's choices. */
  shops: Array<{ id: string; name: string }>;
  counts: { open: number } & Record<LiveFlag, number>;
  as_of: string;
}

export type IssueKind = "missing_item" | "wrong_item" | "late" | "quality" | "rider" | "payment" | "other";
export type IssueOutcome = "refund" | "voucher" | "none";

export interface OrderIssue {
  id: string;
  kind: IssueKind;
  kind_label: string;
  note: string | null;
  status: "open" | "resolved" | "rejected";
  outcome: IssueOutcome | null;
  amount: string | null;
  voucher_code: string | null;
  answer: string | null;
  reported_at: string | null;
  resolved_at: string | null;
  order: { id: string; order_number: string; customer_name: string; customer_phone: string | null; total: string; status: string; payment_method: string; placed_at: string | null };
  shop: { id: string; business_name: string; slug: string; takes_vouchers: boolean };
}

export interface LiveFilters {
  flag?: LiveFlag | "";
  search?: string;
  shop?: string;
  status?: string;
  payment?: string;
  fulfillment?: string;
}

export const ISSUE_KIND_LABEL: Record<IssueKind, string> = {
  missing_item: "Something was missing",
  wrong_item: "Wrong item",
  late: "Arrived very late",
  quality: "Food or item quality",
  rider: "Problem with the rider",
  payment: "Charged wrongly",
  other: "Something else",
};

export const ordersDeskService = {
  rules: () => apiGet<DeliveryRules>("/admin/delivery-rules"),
  saveRules: (body: Partial<DeliveryRules>) => apiPut<DeliveryRules>("/admin/delivery-rules", body),
  live: (filters: LiveFilters) =>
    apiGet<LiveBoard>("/admin/live-orders", { params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }),
  cancel: (id: string, reason: string) => apiPost<LiveOrder>(`/admin/live-orders/${id}/cancel`, { reason }),
  issues: (status: "open" | "resolved" | "rejected", filters: { search?: string; kind?: string } = {}, page = 1) =>
    apiGet<OrderIssue[]>("/admin/order-issues", { params: { status, page, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) } }),
  resolve: (id: string, body: { outcome: IssueOutcome; amount?: number | null; answer: string }) =>
    apiPost<OrderIssue>(`/admin/order-issues/${id}/resolve`, body),
};

/** What each stuck flag is called on the board. */
export const FLAG_LABEL: Record<LiveFlag, string> = {
  shop_slow: "Shop not answering",
  no_rider: "No rider",
  transfer_unchecked: "Transfer not checked",
  late: "Running late",
};
