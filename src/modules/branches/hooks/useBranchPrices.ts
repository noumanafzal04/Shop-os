import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { branchPriceService } from "../services/branchPriceService";

export function useBranchPrices(productId: string | null) {
  return useQuery({
    queryKey: ["branch-prices", productId],
    queryFn: async () => (await branchPriceService.get(productId as string)).data,
    enabled: !!productId,
  });
}

export function useSetBranchPrices(productId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (prices: Array<{ branch_id: string; price: number | null }>) =>
      branchPriceService.set(productId, prices),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-prices", productId] });
      // The list shows the operating branch's effective price — refresh it.
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
