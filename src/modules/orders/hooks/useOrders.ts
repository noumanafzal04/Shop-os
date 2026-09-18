import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ordersService, type Order, type OrderQuery, type OrdersMeta } from "../services/ordersService";
import type { OrderStatus } from "../services/orderStages";

/**
 * The queue refreshes faster than the dashboard.
 *
 * Fifteen seconds, and the same number the rider app's board uses. An order
 * arriving is the one thing in this app somebody is actually waiting for, and
 * a minute-stale queue during a lunch rush is a customer who has been standing
 * there while the shop believed nothing had come in.
 *
 * Push notifications will make this a fallback rather than the mechanism. It
 * stays either way — a poll that keeps working when a notification is missed
 * is the difference between a late order and a lost one.
 */
export const ORDERS_POLL_MS = 15_000;

export function useOrders(query: OrderQuery) {
  return useQuery({
    queryKey: ["orders", query],
    queryFn: async () => {
      const res = await ordersService.list(query);
      return {
        orders: res.data,
        meta: (res.meta ?? {}) as OrdersMeta,
        pagination: res.meta?.pagination,
      };
    },
    refetchInterval: ORDERS_POLL_MS,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ["order", id],
    queryFn: async (): Promise<Order> => (await ordersService.show(id)).data,
  });
}

/**
 * Moving an order along, and what has to be forgotten afterwards.
 *
 * Both the list AND this order — the queue's stage counts are computed
 * server-side over the whole set, so a screen that only re-read the one order
 * would show it in its new stage under a chip still claiming the old count.
 * The dashboard's pipeline is the same figure again and is invalidated too.
 */
export function useAdvanceOrder() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      ordersService.advance(id, status),
    onSuccess: (_res, { id }) => {
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["order", id] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      ordersService.cancel(id, reason),
    onSuccess: (_res, { id }) => {
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["order", id] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
