import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  transferService,
  type ReceiveInput,
  type ShortOutcome,
  type TransferInput,
  type TransferStatus,
} from "../services/transferService";
import { stockByPlaceService, type StockByPlaceQuery } from "../services/stockByPlaceService";

export function useTransfers(page = 1, status?: TransferStatus) {
  return useQuery({
    queryKey: ["transfers", page, status ?? "all"],
    queryFn: async () => await transferService.list(page, status),
    placeholderData: keepPreviousData,
  });
}

/**
 * Everything a transfer changes, in one place.
 *
 * Sending, receiving, settling and calling back each move stock at one end or
 * both, so they all leave the same four things stale: the transfers themselves,
 * the catalogue's totals, any open "who has this" lookup, and the stock
 * screens — which read a different cache entirely.
 */
function useStockMoved() {
  const qc = useQueryClient();

  return () => {
    qc.invalidateQueries({ queryKey: ["transfers"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["branch-stock"] });
    qc.invalidateQueries({ queryKey: ["stock-by-place"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
  };
}

export function useCreateTransfer() {
  const moved = useStockMoved();

  return useMutation({ mutationFn: (payload: TransferInput) => transferService.create(payload), onSuccess: moved });
}

export function useSendTransfer() {
  const moved = useStockMoved();

  return useMutation({
    mutationFn: ({ id, items }: { id: string; items?: Array<{ id: string; quantity: number }> }) => transferService.send(id, items),
    onSuccess: moved,
  });
}

export function useReceiveTransfer() {
  const moved = useStockMoved();

  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & ReceiveInput) => transferService.receive(id, payload),
    onSuccess: moved,
  });
}

export function useSettleTransfer() {
  const moved = useStockMoved();

  return useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: ShortOutcome }) => transferService.settle(id, outcome),
    onSuccess: moved,
  });
}

export function useCancelTransfer() {
  const moved = useStockMoved();

  return useMutation({ mutationFn: (id: string) => transferService.cancel(id), onSuccess: moved });
}

/** Cross-place availability for one product (lazy — enable when a lookup opens). */
export function useBranchStock(productId: string | null) {
  return useQuery({
    queryKey: ["branch-stock", productId],
    queryFn: async () => (await transferService.branchStock(productId as string)).data,
    enabled: !!productId,
  });
}

/** Every place's figure for a page of products. */
export function useStockByPlace(query: StockByPlaceQuery, enabled = true) {
  return useQuery({
    queryKey: ["stock-by-place", query.page ?? 1, query.search ?? "", query.at ?? "", query.only ?? ""],
    queryFn: async () => await stockByPlaceService.list(query),
    placeholderData: keepPreviousData,
    enabled,
  });
}
