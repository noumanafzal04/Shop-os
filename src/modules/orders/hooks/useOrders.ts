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
  shop?: { slug: string | null; business_name: string | null; logo_url?: string | null };
  status: OrderStatus;
  fulfillment_type: "delivery" | "pickup";
  delivery_address: string | null;
  /** The door the customer pinned — the other end of the tracking map. Null for a typed address. */
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  subtotal: string;
  /**
   * All the money off the goods — coupon, the shop's promotion and a member's
   * discount (an order is priced by the till's rules since 2026-11-11) — and
   * how it was made up. Absent shares: an order from before, whose whole
   * discount was the coupon's.
   */
  discount?: string;
  coupon_code?: string | null;
  promotion_name?: string | null;
  promotion_discount?: string;
  member_discount?: string;
  /** The tax it was quoted — inside the prices or on top of them. */
  tax?: string;
  tax_inclusive?: boolean;
  delivery_fee: string;
  small_order_fee?: string;
  service_fee?: string;
  rush_fee?: string;
  distance_fee?: string;
  total: string;
  /** Cash at the door, or a transfer to the shop's account with its reference. */
  payment_method?: "cod" | "transfer" | "paid";
  payment_reference?: string | null;
  /** The shop saw the transfer arrive. */
  payment_received?: boolean;
  /** A problem the customer reported with it, and the platform's answer. */
  issue?: OrderIssue | null;
  /** Whether a problem may be reported now. */
  can_report_issue?: boolean;
  items: Array<{
    /** For "Order again"; null once the shop deleted the product. */
    product_id?: string | null;
    variant_id?: string | null;
    product_unit_id?: string | null;
    product_name: string;
    variant_name: string | null;
    modifiers?: unknown[] | null;
    quantity: number;
    line_total: string;
  }>;
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
    /**
     * Straight-line kilometres from the rider to the delivery pin.
     *
     * Computed by the server — `Geo::distanceKm` lives there, and a haversine
     * in here would be a second copy of one rule. Null whenever the pin is
     * null, and also when the order itself has no coordinates: plenty of
     * orders are a typed address, and the distance from a null island is the
     * kind of number that ends up in a screenshot.
     */
    distance_km: number | null;
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

export type IssueKind = "missing_item" | "wrong_item" | "late" | "quality" | "rider" | "payment" | "other";

export interface OrderIssue {
  id: string;
  kind: IssueKind;
  kind_label: string;
  note: string | null;
  status: "open" | "resolved" | "rejected";
  outcome: "refund" | "voucher" | "none" | null;
  amount: string | null;
  voucher_code: string | null;
  answer: string | null;
  reported_at: string | null;
  resolved_at: string | null;
}

export interface PlaceOrderPayload {
  shop_slug: string;
  fulfillment_type: "delivery" | "pickup";
  delivery_address?: string;
  latitude?: number;
  longitude?: number;
  coupon_code?: string;
  notes?: string;
  /** Cash at the door, or a transfer to the shop's own account (with its reference). */
  payment_method?: "cod" | "transfer";
  payment_reference?: string;
  items: Array<{
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    modifier_option_ids?: string[];
  }>;
  idempotency_key?: string;
}

export function makeKey(): string {
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

/** The server's own figures for an order not yet placed (`/customer/orders/worth`). */
export interface OrderWorth {
  subtotal: number;
  discount: number;
  coupon_code: string | null;
  coupon_discount: number;
  promotion_name: string | null;
  promotion_discount: number;
  member_discount: number;
  tax: number;
  tax_inclusive: boolean;
  delivery_fee: number;
  total: number;
}

/**
 * WHAT THIS ORDER COMES TO — ASKED, NOT ADDED UP.
 *
 * Checkout added the basket and the delivery fee itself and said "coupon
 * checked when you order". Since an order is taxed and takes the shop's
 * offers, that sum is a different figure from the one charged — a customer
 * shown Rs 1,000 and asked for Rs 1,050 at the door. The placing path is run
 * and stopped before it places (no order, no stock held, no coupon spent).
 *
 * `asked` is the payload as TEXT, debounced by the screen: one question per
 * pause, not one per keystroke, and an identical question is answered from the
 * cache. The last answer stays up while the next is asked, so the figures do
 * not blink. A refusal (a coupon that is spent, a minimum not met) is the
 * answer, not a blip — never retried.
 */
export function useOrderWorth(asked: string, enabled: boolean) {
  return useQuery({
    queryKey: ["orders", "worth", asked],
    queryFn: async () => (await apiPost<OrderWorth>("/customer/orders/worth", JSON.parse(asked))).data,
    enabled,
    staleTime: 30_000,
    gcTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
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
      // The screen holds the key for the whole attempt (see Checkout): a key
      // minted at the press is no key — a retry after a dropped answer would
      // be a second order. This default only covers a caller that sent none.
      apiPost<CustomerOrder>("/customer/orders", { idempotency_key: makeKey(), ...payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders", "mine"] }),
  });
}

/** "Order mein masla" — one report per order; the platform answers it on the order. */
export function useReportIssue(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind: IssueKind; note?: string }) => apiPost<OrderIssue>(`/customer/orders/${orderId}/issue`, body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });
}

export function useCancelMyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/customer/orders/${id}/cancel`),
    // Settled, and the whole `["orders"]` key: a cancel the shop beat (it
    // accepted first) must show the order as it now is — `["orders","mine"]`
    // alone left the order's own screen, `["orders","one",id]`, unread.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });
}
