import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { pharmacyService } from "../services/pharmacyService";

/**
 * Equivalents for one drug. Only fetched when the counter actually asks —
 * a lookup fired on every cart line would be noise on a busy till.
 */
export function useAlternatives(productId: string | null, inStockOnly = true) {
  return useQuery({
    queryKey: ["pharmacy", "alternatives", productId, inStockOnly],
    queryFn: async () => (await pharmacyService.alternatives(productId!, inStockOnly)).data,
    enabled: !!productId,
    staleTime: 30_000,
  });
}

export function useDispensingRegister(params: {
  from?: string;
  to?: string;
  search?: string;
  controlled_only?: boolean;
}) {
  return useQuery({
    queryKey: ["pharmacy", "dispensing", params],
    queryFn: async () => (await pharmacyService.dispensing(params)).data,
    placeholderData: keepPreviousData,
  });
}

/** Only runs once a lot number is actually entered — a recall is deliberate. */
export function useRecall(batchNumber: string) {
  return useQuery({
    queryKey: ["pharmacy", "recall", batchNumber],
    queryFn: async () => (await pharmacyService.recall(batchNumber)).data,
    enabled: batchNumber.trim().length > 0,
  });
}
