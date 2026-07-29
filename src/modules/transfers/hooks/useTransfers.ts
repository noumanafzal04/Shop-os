import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { transferService, type TransferInput } from "../services/transferService";

export function useTransfers(page = 1) {
  return useQuery({
    queryKey: ["transfers", page],
    queryFn: async () => await transferService.list(page),
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: TransferInput) => transferService.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfers"] });
      // A transfer changes on-hand at both branches, so the catalog rollup and
      // any open branch-stock lookups are now stale.
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["branch-stock"] });
    },
  });
}

/** Cross-branch availability for one product (lazy — enable when a lookup opens). */
export function useBranchStock(productId: string | null) {
  return useQuery({
    queryKey: ["branch-stock", productId],
    queryFn: async () => (await transferService.branchStock(productId as string)).data,
    enabled: !!productId,
  });
}
