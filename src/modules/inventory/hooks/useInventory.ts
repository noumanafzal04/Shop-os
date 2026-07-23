import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { inventoryService, type AdjustPayload } from "../services/inventoryService";

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

export function useExpiring(days = 30) {
  return useQuery({
    queryKey: ["inventory", "expiring", days],
    queryFn: async () => (await inventoryService.expiring(days)).data,
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
    mutationFn: ({ productId, ...payload }: { productId: string; batch_number: string; expiry_date?: string; quantity: number; cost?: number }) =>
      inventoryService.addBatch(productId, payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; batch_number?: string; expiry_date?: string | null }) =>
      inventoryService.updateBatch(id, payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => inventoryService.removeBatch(id), onSuccess: invalidate });
  return { add, update, remove };
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
