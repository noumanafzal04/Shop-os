import { useCallback, useEffect } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ordersService,
  type CounterOrderPayload,
  type OrderAsked,
  type OrderQueueFilters,
  type OrderStatus,
  type PlaceOrderPayload,
} from "../services/ordersService";
import { uuid } from "../../../common/uuid";
import type { OrdersWaiting } from "../../../layout/ordersWaiting";
import { useAuthStore } from "../../../stores/authStore";
import { useNotifications } from "../../notifications/hooks/useNotifications";
import { HEAL_AFTER, heardAt, isNews, keptFor, newestOrderNews, ownerOf } from "../waitingCount";
import { useWaitingStore } from "../waitingStore";

export function useMyOrders(page = 1) {
  return useQuery({
    queryKey: ["orders", "mine", page],
    queryFn: () => ordersService.myOrders(page),
    placeholderData: keepPreviousData,
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PlaceOrderPayload) =>
      ordersService.place({ idempotency_key: uuid(), ...payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders", "mine"] }),
  });
}

export function useCancelMyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ordersService.cancelMine(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders", "mine"] }),
  });
}

/**
 * The shop taking an order itself. Keyed idempotently because a shop phone in
 * a noisy room gets double-tapped, and two identical orders would each hold
 * their own stock.
 */
/**
 * What the order on the screen will come to — the server's figure, asked
 * again every time the order changes.
 *
 * Its own key, apart from everything a saved order invalidates, and never
 * served from an old answer: the figure shown must be for THIS order, not the
 * one before the last tap.
 */
export function useOrderWorth(asked: string, enabled: boolean) {
  return useQuery({
    queryKey: ["order-worth", asked],
    queryFn: async () => (await ordersService.worth(JSON.parse(asked) as OrderAsked)).data,
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    // A refusal is an answer, not a blip.
    retry: false,
  });
}

export function useTakeOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CounterOrderPayload) =>
      ordersService.takeOrder({ idempotency_key: uuid(), ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", "shop"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      // A counter order draws down stock the moment it is taken.
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}

// owner
export function useShopOrders(params: OrderQueueFilters, enabled = true) {
  return useQuery({
    queryKey: ["orders", "shop", params],
    queryFn: () => ordersService.shopOrders(params),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000, // new orders surface without manual refresh
  });
}

/** Where the count beside "Orders" lives in the cache. Under `["orders"]`, on purpose. */
const WAITING = ["orders", "shop", "waiting"] as const;

/**
 * How many orders are waiting — for the count beside "Orders" on the menu.
 *
 * KEPT, and asked for again only when an order was made or has moved; why,
 * and the one exception, are in `waitingCount.ts`. In short:
 *
 *   a reload           shows what was kept and asks nothing, inside two minutes
 *   this device        its own taking, confirming and cancelling invalidate
 *                      the `["orders"]` key this lives under
 *   another device     a new order rings the bell, and the bell's news asks
 *   the Orders screen  tells it directly — `useTellTheMenu`
 *   nobody             after two minutes with no word, it asks once
 */
export function useOrdersWaiting(enabled: boolean) {
  const queryClient = useQueryClient();
  const owner = useAuthStore((s) => ownerOf(s.user?.tenant?.id, s.user?.id));
  const kept = useWaitingStore((s) => keptFor(s.kept, owner));
  const keep = useWaitingStore((s) => s.keep);
  const hear = useWaitingStore((s) => s.hear);
  const on = enabled && owner !== null;
  const held = on ? kept?.count : undefined;

  const query = useQuery({
    queryKey: WAITING,
    queryFn: async () => (await ordersService.waiting()).data,
    enabled: on,
    // What the device kept is what the menu opens with — and how old it is
    // decides whether the server is asked at all.
    initialData: held ? { new: held.new, being_worked: held.being_worked } : undefined,
    initialDataUpdatedAt: () => (held ? heardAt(held, Date.now()) : undefined),
    staleTime: HEAL_AFTER,
    // The exception: two minutes with no word from anywhere. Any answer —
    // asked for, or told by the Orders screen — starts the two minutes again.
    refetchInterval: HEAL_AFTER,
  });

  // Whatever was last said is kept, whoever said it.
  const { data, dataUpdatedAt } = query;
  const keptAt = kept?.count?.at;
  useEffect(() => {
    if (!on || owner === null || data === undefined || dataUpdatedAt === 0 || keptAt === dataUpdatedAt) return;
    keep(owner, { new: data.new, being_worked: data.being_worked, at: dataUpdatedAt });
  }, [on, owner, data, dataUpdatedAt, keptAt, keep]);

  // The bell. It is asked by the header anyway; this only reads what it said.
  const bell = useNotifications(1);
  const news = on ? newestOrderNews(bell.data?.data) : undefined;
  const heard = kept?.heard;
  useEffect(() => {
    if (!on || owner === null || news === undefined || heard === news) return;
    if (isNews(heard, news)) queryClient.invalidateQueries({ queryKey: WAITING });
    hear(owner, news);
  }, [on, owner, news, heard, hear, queryClient]);

  return query;
}

/**
 * The Orders screen has the figure in its own list — the same count of the
 * same orders — so it tells the menu, and the menu does not ask.
 *
 * It is also what keeps the two from disagreeing on one screen: the board is
 * asked every half minute while it is open, and a count beside it that was
 * two minutes old would say four over three cards.
 */
export function useTellTheMenu(): (waiting: OrdersWaiting) => void {
  const queryClient = useQueryClient();

  return useCallback((waiting: OrdersWaiting) => { queryClient.setQueryData(WAITING, waiting); }, [queryClient]);
}

export function useOrderActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["sales"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => ordersService.advance(id, status),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => ordersService.cancel(id, reason),
    onSuccess: invalidate,
  });
  const assignRider = useMutation({
    mutationFn: ({ id, riderId }: { id: string; riderId: string | null }) => ordersService.assignRider(id, riderId),
    onSuccess: invalidate,
  });

  return { advance, cancel, assignRider };
}

export function useRiders(enabled = true) {
  return useQuery({
    queryKey: ["riders"],
    queryFn: async () => (await ordersService.riders()).data,
    // `/riders` is the Delivery module's — see the Orders screen.
    enabled,
  });
}

export function useRiderMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["riders"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };
  const create = useMutation({
    mutationFn: (payload: { name: string; phone?: string }) => ordersService.createRider(payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; phone?: string | null; is_active?: boolean }) =>
      ordersService.updateRider(id, payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => ordersService.deleteRider(id),
    onSuccess: invalidate,
  });
  const invite = useMutation({
    mutationFn: (rider_code: string) => ordersService.inviteRider(rider_code),
    onSuccess: invalidate,
  });
  const settle = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; amount_paid?: number; note?: string }) =>
      ordersService.settleRider(id, payload),
    onSuccess: invalidate,
  });
  return { create, update, remove, invite, settle };
}

/**
 * What one rider is holding, order by order.
 *
 * Fetched only while the settle dialog is open — a shop with forty riders must
 * not ask for forty statements to draw a list.
 */
export function useRiderStatement(id: string | null) {
  return useQuery({
    queryKey: ["riders", "statement", id],
    queryFn: async () => (await ordersService.riderStatement(id!)).data,
    enabled: !!id,
  });
}
