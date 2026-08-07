import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiGet, apiPost } from "../../../common/api/client";

export type OrderStatus =
  | "pending" | "confirmed" | "preparing" | "ready"
  | "out_for_delivery" | "completed" | "cancelled";

export interface CustomerOrder {
  id: string;
  order_number: string;
  shop?: { slug: string | null; business_name: string | null };
  status: OrderStatus;
  fulfillment_type: "delivery" | "pickup";
  delivery_address: string | null;
  subtotal: string;
  delivery_fee: string;
  total: string;
  items: Array<{ product_name: string; variant_name: string | null; quantity: number; line_total: string }>;
  placed_at: string;
}

export interface PlaceOrderPayload {
  shop_slug: string;
  fulfillment_type: "delivery" | "pickup";
  delivery_address?: string;
  latitude?: number;
  longitude?: number;
  coupon_code?: string;
  notes?: string;
  items: Array<{
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    modifier_option_ids?: string[];
  }>;
  idempotency_key?: string;
}

function makeKey(): string {
  return `mob-ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useMyOrders() {
  return useQuery({
    queryKey: ["orders", "mine"],
    queryFn: () => apiGet<CustomerOrder[]>("/customer/orders"),
    placeholderData: keepPreviousData,
  });
}

export function useMyOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["orders", "one", id],
    queryFn: async () => (await apiGet<CustomerOrder>(`/customer/orders/${id}`)).data,
    enabled: !!id,
    // Live tracking: poll while the order is still moving.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !["completed", "cancelled"].includes(status) ? 20000 : false;
    },
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PlaceOrderPayload) =>
      apiPost<CustomerOrder>("/customer/orders", { idempotency_key: makeKey(), ...payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders", "mine"] }),
  });
}

export function useCancelMyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/customer/orders/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders", "mine"] }),
  });
}
