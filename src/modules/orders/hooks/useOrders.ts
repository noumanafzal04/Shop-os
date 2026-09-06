import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiGet, apiPost } from "../../../common/api/client";
import { pollEvery } from "../../../common/api/backoff";

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

  /**
   * Who is bringing it, and where they are in the trip.
   *
   * `stage` comes from the RIDER'S timestamps, not from the order status:
   * those two disagree by design for most of a delivery, because an order sits
   * at `preparing` while the rider is already on the way to collect it.
   *
   * The pin is present only while they are actually carrying this order AND
   * their phone is still reporting. A stale pin is worse than none — it shows
   * a rider parked somewhere they left ten minutes ago.
   */
  rider?: {
    name: string;
    stage: "assigned" | "to_pickup" | "on_the_way" | "delivered";
    accepted_at: string | null;
    picked_up_at: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;

  /**
   * The four digits the rider asks for at the door.
   *
   * Present only while the order is out for delivery, which is the only time
   * it means anything — handed over at checkout it would be a number nobody
   * remembers by the time it is wanted.
   */
  delivery_otp?: string | null;
  delivered_at?: string | null;
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

/**
 * Everything this person has ordered, fifteen at a time.
 *
 * The endpoint has paged from the beginning and the app asked for one page, so
 * somebody with a year of orders could see fifteen of them.
 */
export function useMyOrders() {
  return useInfiniteQuery({
    queryKey: ["orders", "mine"],
    queryFn: ({ pageParam }) =>
      apiGet<CustomerOrder[]>("/customer/orders", { params: { page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const p = last.meta?.pagination;
      if (p == null || p.current_page >= p.last_page) return undefined;

      return p.current_page + 1;
    },
    placeholderData: keepPreviousData,
  });
}

export function useMyOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["orders", "one", id],
    queryFn: async () => (await apiGet<CustomerOrder>(`/customer/orders/${id}`)).data,
    enabled: !!id,
    /**
     * Live tracking, at two speeds.
     *
     * There is no websocket server in this product yet, so this is what
     * "realtime" is: a poll, and a refresh control that says how old the
     * answer is (see `RefreshPill`).
     *
     * The interval is not one number, because the question is not one
     * question. An order waiting for a shop to press "accept" changes every
     * few minutes; an order with a rider carrying it toward your door moves
     * continuously, and ten seconds is the difference between a live map and
     * a picture of one. A finished order asks nothing at all.
     */
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || ["completed", "cancelled"].includes(status)) return false;

      // …and held back entirely while the server is refusing for rate. A poll
      // that keeps its clock through a 429 is refused six times a minute for
      // as long as the screen is open.
      return pollEvery(status === "out_for_delivery" ? 10_000 : 20_000);
    },
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    // Reported by the screen itself — checkout shows the refusal in place, beside the order it refused — so the global
    // toast would say the same thing twice, in two shapes, one of
    // them floating over the form the person is still reading.
    // See `queryClient.ts`.
    meta: { silent: true },
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
