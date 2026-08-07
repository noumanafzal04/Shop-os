import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryService, type AdjustPayload } from "../services/inventoryService";

/** RN/Hermes-safe unique key (no crypto.randomUUID guarantee). */
function makeIdempotencyKey(): string {
  return `mob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useProductMovements(productId: string | undefined) {
  return useQuery({
    queryKey: ["inventory", "movements", productId],
    queryFn: async () => (await inventoryService.movements({ product_id: productId })).data,
    enabled: !!productId,
  });
}

export function useAdjustStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AdjustPayload) =>
      inventoryService.adjust({ idempotency_key: makeIdempotencyKey(), ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
