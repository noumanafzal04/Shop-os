import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { stocktakeService, type StartCountInput } from "../services/stocktakeService";
import { useAuthStore } from "../../../stores/authStore";

/** Counting shelves needs shelves — the stock module, nothing else. */
function useStockShop() {
  const role = useAuthStore((s) => s.user?.role);
  const tracksStock = !!useAuthStore((s) => s.user?.tenant?.features?.inventory);
  return (role === "shop_owner" || role === "staff") && tracksStock;
}

export function useStockCounts(params: { status?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ["stock-counts", params],
    queryFn: () => stocktakeService.list(params),
    enabled: useStockShop(),
  });
}

export function useCurrentCount() {
  return useQuery({
    queryKey: ["stock-counts", "current"],
    queryFn: async () => (await stocktakeService.current()).data,
    enabled: useStockShop(),
  });
}

export function useCountSheet(id: string | undefined, params: { search?: string; uncounted?: boolean } = {}) {
  return useQuery({
    queryKey: ["stock-counts", "sheet", id, params],
    queryFn: async () => (await stocktakeService.sheet(id!, params)).data,
    enabled: !!id,
    // The counter is the only writer, and their own edits are applied
    // optimistically — refetching underneath them would fight the keyboard.
    refetchOnWindowFocus: false,
  });
}

/**
 * The figures the Apply sheet asks a person to sign (next rounds #21), read
 * from the server once the last typed figure has landed. The sheet's own query
 * is never refetched while counting, so the sheet signed the totals as the page
 * first loaded them — "Lines counted 0 · Net 0" over a count that then moved
 * Rs 2,200 of stock.
 */
export function useApplyFigures(countId: string | undefined, open: boolean) {
  const saving = useIsMutating({ mutationKey: ["stock-counts", "record", countId] });

  return useQuery({
    queryKey: ["stock-counts", "apply-figures", countId],
    queryFn: async () => (await stocktakeService.sheet(countId!, {})).data.summary,
    enabled: !!countId && open && saving === 0,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useStocktakeMutations(countId?: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stock-counts"] });
    // Applying a count moves stock, so anything reading stock is now stale.
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  return {
    start: useMutation({
      mutationFn: (payload: StartCountInput) => stocktakeService.start(payload),
      onSuccess: invalidate,
    }),
    record: useMutation({
      // Named, so the Apply sheet can wait until every typed figure has landed.
      mutationKey: ["stock-counts", "record", countId],
      mutationFn: (lines: Array<{ item_id: string; counted_quantity: number | null }>) =>
        stocktakeService.record(countId!, lines),
      // Deliberately NOT invalidating the sheet: the input the counter is
      // typing in must not be replaced under their hands. The progress figure
      // comes back in the response.
    }),
    apply: useMutation({
      mutationFn: (notes?: string) => stocktakeService.apply(countId!, notes),
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: (id: string) => stocktakeService.cancel(id),
      onSuccess: invalidate,
    }),
  };
}
