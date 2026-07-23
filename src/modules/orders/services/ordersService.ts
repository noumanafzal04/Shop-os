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
  subtotal: string;
  delivery_fee: string;
  total: string;
  items: OrderItem[];
  placed_at: string;
}

export interface PlaceOrderPayload {
  shop_slug: string;
  fulfillment_type: "delivery" | "pickup";
  delivery_address?: string;
  payment_method?: "cod" | "paid";
  items: Array<{ product_id: string; variant_id?: string | null; quantity: number; modifier_option_ids?: string[] }>;
  notes?: string;
  idempotency_key?: string;
  coupon_code?: string;
}

export interface Rider {
  id: string;
  name: string;
  phone: string | null;
  is_active: boolean;
  active_deliveries?: number;
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
  delivery_address: string | null;
  subtotal: string;
  delivery_fee: string;
  total: string;
  notes: string | null;
  placed_at: string;
  items: OrderItem[];
  rider_id: string | null;
  rider?: Rider | null;
}

export const ordersService = {
  // customer
  myOrders: (page = 1) => apiGet<CustomerOrder[]>("/customer/orders", { params: { page } }),
  place: (payload: PlaceOrderPayload) => apiPost<CustomerOrder>("/customer/orders", payload),
  cancelMine: (id: string) => apiPost<CustomerOrder>(`/customer/orders/${id}/cancel`),

  // owner
  shopOrders: (params: { status?: string; page?: number }) =>
    apiGet<OwnerOrder[]>("/orders", {
      params: { status: params.status || undefined, page: params.page ?? 1 },
    }),
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
};
