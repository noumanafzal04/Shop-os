import { apiGet, apiPost } from "@cartze/core/api/client";
import type { ApiEnvelope } from "@cartze/core/types/api";
import type { FulfillmentType, OrderStatus } from "./orderStages";

/**
 * THE QUEUE, AND ONE ORDER IN IT.
 *
 * Fields read out of `create_orders_tables.php` and the controller rather than
 * guessed. The server returns the MODEL — there is no OrderResource — so what
 * arrives is the columns plus whatever relations were eager-loaded, which for
 * this screen is `items`, `rider` and `branch`.
 */

export interface OrderItem {
  id: string;
  /** A SNAPSHOT taken when the order was placed — not the product's name now. */
  product_name: string;
  variant_name: string | null;
  modifiers: Array<{ name?: string; option?: string }> | null;
  quantity: string | number;
  unit_price: string | number;
  line_total: string | number;
}

export interface Order {
  id: string;
  order_number: string;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  payment_method: string;
  payment_status: string;
  customer_name: string;
  customer_phone: string | null;
  delivery_address: string | null;
  subtotal: string | number;
  discount?: string | number;
  delivery_fee: string | number;
  total: string | number;
  notes: string | null;
  cancel_reason: string | null;
  placed_at: string;
  rider_id: string | null;
  rider?: { id: string; name: string; phone: string | null } | null;
  items?: OrderItem[];
}

/**
 * Counts per stage, with a ZERO for every stage nothing is in.
 *
 * The server builds it with conditional sums rather than a GROUP BY for
 * exactly that reason: a missing key would draw a chip with no number beside
 * six that have one, and "no number" reads as "not counted", not as "none".
 */
export type StageCounts = Record<string, number> & { all: number };

export interface OrdersMeta {
  status_counts?: StageCounts;
  /**
   * Deliveries with nobody carrying them — counted whatever stage is on
   * screen, because it is a WARNING and not a filter result. An order marked
   * out for delivery with no rider is a customer waiting for a bike that was
   * never sent.
   */
  unassigned?: number;
}

export interface OrderQuery {
  status?: OrderStatus;
  open_only?: boolean;
  search?: string;
  page?: number;
}

export const ordersService = {
  list: (q: OrderQuery = {}): Promise<ApiEnvelope<Order[]>> =>
    apiGet<Order[]>("/orders", {
      params: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.open_only ? { open_only: 1 } : {}),
        ...(q.search ? { search: q.search } : {}),
        ...(q.page ? { page: q.page } : {}),
      },
    }),

  show: (id: string): Promise<ApiEnvelope<Order>> => apiGet<Order>(`/orders/${id}`),

  /**
   * Move it along. The server re-checks the transition and answers
   * `ORDER_INVALID_TRANSITION` if the app offered a step it should not have —
   * so the worst a stale mirror can do is a button that fails, never an order
   * moved somewhere it should not go.
   */
  advance: (id: string, status: OrderStatus): Promise<ApiEnvelope<Order>> =>
    apiPost<Order>(`/orders/${id}/advance`, { status }),

  cancel: (id: string, reason?: string): Promise<ApiEnvelope<Order>> =>
    apiPost<Order>(`/orders/${id}/cancel`, reason ? { reason } : {}),
};
