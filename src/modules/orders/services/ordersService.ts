import { apiDelete, apiGet, apiPatch, apiPost } from "../../../common/api/client";

export type OrderStatus =
  | "pending" | "confirmed" | "preparing" | "ready"
  | "out_for_delivery" | "completed" | "cancelled";

export interface OrderItem {
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface CustomerOrder {
  id: string;
  order_number: string;
  shop?: { slug: string | null; business_name: string | null };
  status: OrderStatus;
  fulfillment_type: "delivery" | "pickup";
  payment_method: string;
  payment_status: string;
  delivery_address: string | null;
  /**
   * Where it is coming from — and for a pickup, where to walk to. The branch
   * that fills an order is chosen by distance, so a collecting customer has no
   * other way of knowing which shop is holding it.
   */
  branch?: { name: string; address: string | null; phone: string | null } | null;
  subtotal: string;
  delivery_fee: string;
  total: string;
  items?: OrderItem[];
  placed_at: string;
}

export interface PlaceOrderPayload {
  shop_slug: string;
  fulfillment_type: "delivery" | "pickup";
  delivery_address?: string;
  payment_method?: "cod" | "paid";
  items?: Array<{ product_id: string; variant_id?: string | null; quantity: number; modifier_option_ids?: string[] }>;
  notes?: string;
  idempotency_key?: string;
  coupon_code?: string;
}

/**
 * An order the shop takes itself — a phone call, a WhatsApp message, someone
 * at the counter asking for delivery. Deliberately carries NO prices: the
 * server decides what it costs, exactly as it does for a web checkout. A
 * counter that could type its own prices is a counter that can discount
 * without anyone knowing.
 */
export interface CounterOrderPayload {
  channel?: "phone" | "whatsapp" | "walk_in";
  customer_name: string;
  customer_phone?: string;
  fulfillment_type: "delivery" | "pickup";
  delivery_address?: string;
  payment_method?: "cod" | "paid";
  items?: Array<{ product_id: string; variant_id?: string | null; quantity: number }>;
  notes?: string;
  idempotency_key?: string;
}

export interface Rider {
  id: string;
  name: string;
  phone: string | null;
  is_active: boolean;
  active_deliveries?: number;

  /**
   * The cash this rider is holding for THIS shop, and what they earned on it.
   *
   * Derived from the orders every time — delivered, paid in cash, not yet
   * settled. There is no stored balance anywhere, on purpose: a second copy of
   * a number the orders already answer drifts the first time one is refunded.
   */
  unsettled_orders?: number;
  cash_in_hand?: number;

  /**
   * Whether this row is also a PERSON with the app.
   *
   * Null everywhere for a shop whose riders are its cousins with a phone
   * number, which is the normal case and always will be. Set means the rider
   * sees this shop's deliveries on their own phone and moves them along
   * themselves.
   */
  has_app?: boolean;
  rider_code?: string | null;
  app_status?: string | null;
  is_online?: boolean;
  vehicle_type?: string | null;
}

/** One rider's unsettled cash, order by order. */
export interface RiderStatement {
  rider: Rider;
  orders: Array<{
    id: string;
    order_number: string;
    total: string;
    delivery_fee: string;
    delivered_at: string | null;
  }>;
  cash_in_hand: number;
  rider_earned: number;
}

// Owner-side order shape (raw model)
export interface OwnerOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  fulfillment_type: "delivery" | "pickup";
  payment_method: string;
  payment_status: string;
  customer_name: string;
  customer_phone: string | null;
  /** Which door it came through: online | phone | whatsapp | walk_in. */
  channel: string;
  delivery_address: string | null;
  subtotal: string;
  delivery_fee: string;
  total: string;
  notes: string | null;
  placed_at: string;
  items?: OrderItem[];
  rider_id: string | null;
  rider?: Rider | null;
  /**
   * Which branch filled it. Null for orders placed before shops tracked this —
   * they genuinely came out of the default branch and no honest value can be
   * invented for them now.
   */
  branch_id: string | null;
  branch?: { id: string; name: string } | null;
}

/**
 * Every axis the shop's order queue can be narrowed by.
 *
 * `channel` and `open_only` were accepted by the server from the day it was
 * written and the screen sent neither — so "how much did the storefront bring
 * in against the phone" was a question the app could answer and could not be
 * asked.
 */
export interface OrderQueueFilters {
  status?: string;
  search?: string;
  channel?: string;
  fulfillment?: "delivery" | "pickup" | "";
  rider_id?: string;
  /** Deliveries nobody is carrying — the one that costs money. */
  unassigned?: boolean;
  from?: string | null;
  to?: string | null;
  page?: number;
}

/** How many orders sit at each stage. Every stage is present, including the
 *  empty ones — a missing key would draw a chip with no number, and that reads
 *  as "not counted" rather than as "none". */
export type OrderStageCounts = Record<string, number>;

export const ordersService = {
  // customer
  myOrders: (page = 1) => apiGet<CustomerOrder[]>("/customer/orders", { params: { page } }),
  place: (payload: PlaceOrderPayload) => apiPost<CustomerOrder>("/customer/orders", payload),
  cancelMine: (id: string) => apiPost<CustomerOrder>(`/customer/orders/${id}/cancel`),

  // owner
  shopOrders: (params: OrderQueueFilters) =>
    apiGet<OwnerOrder[]>("/orders", {
      params: {
        status: params.status || undefined,
        search: params.search || undefined,
        channel: params.channel || undefined,
        fulfillment: params.fulfillment || undefined,
        rider_id: params.rider_id || undefined,
        // `undefined`, never `false`: the server reads this with
        // `$request->boolean()`, and the string "false" is true.
        unassigned: params.unassigned ? true : undefined,
        from: params.from || undefined,
        to: params.to || undefined,
        page: params.page ?? 1,
      },
    }),
  takeOrder: (payload: CounterOrderPayload) => apiPost<OwnerOrder>("/orders", payload),
  advance: (id: string, status: OrderStatus) => apiPost<OwnerOrder>(`/orders/${id}/advance`, { status }),
  cancel: (id: string, reason?: string) => apiPost<OwnerOrder>(`/orders/${id}/cancel`, { reason }),
  assignRider: (id: string, riderId: string | null) =>
    apiPost<OwnerOrder>(`/orders/${id}/assign-rider`, { rider_id: riderId }),

  // riders (the shop's own delivery riders — Model A)
  riders: () => apiGet<Rider[]>("/riders"),
  createRider: (payload: { name: string; phone?: string }) => apiPost<Rider>("/riders", payload),
  updateRider: (id: string, payload: { name?: string; phone?: string; is_active?: boolean }) =>
    apiPatch<Rider>(`/riders/${id}`, payload),
  deleteRider: (id: string) => apiDelete<null>(`/riders/${id}`),

  /**
   * Add somebody who already has the app, by their rider id.
   *
   * By CODE and not by name, deliberately: a shop searching the platform's
   * riders by name would be a searchable directory of strangers' phone
   * numbers. The rider reads the code off their own screen and hands it over.
   */
  inviteRider: (rider_code: string) => apiPost<Rider>("/riders/invite", { rider_code }),
  riderStatement: (id: string) => apiGet<RiderStatement>(`/riders/${id}/statement`),
  settleRider: (id: string, payload: { amount_paid?: number; note?: string }) =>
    apiPost<unknown>(`/riders/${id}/settle`, payload),
};
