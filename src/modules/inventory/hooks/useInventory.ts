import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  inventoryService,
  type AdjustPayload,
  type BatchDisposalInput,
  type DisposalFilters,
} from "../services/inventoryService";

export function useMovements(params: { product_id?: string; page?: number }) {
  return useQuery({
    queryKey: ["inventory", "movements", params],
    queryFn: () => inventoryService.movements(params),
    placeholderData: keepPreviousData,
  });
}

export function useLowStock() {
  return useQuery({
    queryKey: ["inventory", "low-stock"],
    queryFn: async () => (await inventoryService.lowStock()).data,
  });
}

/**
 * Lots inside the expiry window.
 *
 * `days` defaults to UNDEFINED, not 30, so the server answers with the shop's
 * own window — 90 days for a pharmacy, 30 for everyone else. It was hardcoded
 * to 30 in three places, and a pharmacy warned at thirty days is warned after
 * the distributor's return window has already closed.
 */
export function useExpiring(days?: number) {
  return useQuery({
    queryKey: ["inventory", "expiring", days ?? "shop"],
    queryFn: async () => (await inventoryService.expiring(days)).data,
  });
}

/**
 * Lots past the shop's ageing threshold.
 *
 * Same shape as `useExpiring` and the same reasoning about the default: the
 * threshold is the SHOP's (five years out of the box, two for a fleet contract),
 * so the hook does not name a number the server already knows.
 */
export function useAgeing(years?: number) {
  return useQuery({
    queryKey: ["inventory", "ageing", years ?? "shop"],
    queryFn: async () => (await inventoryService.ageing(years)).data,
  });
}

export function useBatches(productId: string | null) {
  return useQuery({
    queryKey: ["inventory", "batches", productId],
    queryFn: async () => (await inventoryService.batches(productId!)).data,
    enabled: !!productId,
  });
}

export function useBatchMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };
  const add = useMutation({
    mutationFn: ({ productId, ...payload }: {
      productId: string; batch_number: string; expiry_date?: string;
      dot_code?: string; manufactured_on?: string; quantity: number; cost?: number;
    }) =>
      inventoryService.addBatch(productId, payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...payload }: {
      id: string; batch_number?: string; expiry_date?: string | null;
      dot_code?: string | null; manufactured_on?: string | null;
    }) =>
      inventoryService.updateBatch(id, payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ id, disposal }: { id: string; disposal?: BatchDisposalInput }) =>
      inventoryService.removeBatch(id, disposal),
    onSuccess: () => {
      invalidate();
      // The claims list and the expiry-loss total are both built from this.
      qc.invalidateQueries({ queryKey: ["disposals"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return { add, update, remove };
}

/** What left the shelf without being sold. */
export function useDisposals(filters: DisposalFilters = {}) {
  return useQuery({
    queryKey: ["disposals", filters],
    queryFn: async () => {
      const res = await inventoryService.disposals(filters);

      return { rows: res.data, pagination: res.meta?.pagination };
    },
    placeholderData: keepPreviousData,
  });
}

export function useCreditDisposal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: {
      id: string; credit_received: number; credit_received_at: string; credit_reference?: string;
    }) => inventoryService.creditDisposal(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["disposals"] }),
  });
}

export function useAdjustStock() {
  const queryClient = useQueryClient();

  return useMutation({
    // The CALLER owns the idempotency key: one stable key per adjustment
    // intent (generated when the adjust dialog opens), so a resubmit after
    // a network error replays the same movement instead of applying twice.
    // Never mint a key here — a fresh key per call defeats the dedupe.
    mutationFn: (payload: AdjustPayload) => inventoryService.adjust(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/**
 * Turn the reorder list into orders somebody can send.
 *
 * Invalidates the purchase-order list AND the low-stock read: the drafts are
 * new orders, and a buyer who has just raised them should not be looking at
 * the same "these are running out" list as though nothing happened.
 */
export function useRaiseReorderOrders() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (productIds: string[]) => inventoryService.orderReorderList(productIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      void qc.invalidateQueries({ queryKey: ["inventory", "low-stock"] });
    },
  });
}
