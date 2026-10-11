import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { salesService, type SaleFilters, type VoidReasonCode } from "../services/salesService";
import type { SaleInput } from "../types";

export function useSales(params: SaleFilters) {
  return useQuery({
    queryKey: ["sales", params],
    queryFn: () => salesService.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useSale(id: string | null) {
  return useQuery({
    queryKey: ["sales", "detail", id],
    queryFn: async () => (await salesService.show(id!)).data,
    enabled: !!id,
  });
}

/**
 * What the lines being handed back are worth — asked of the server before
 * anything is pressed.
 *
 * `asked` is the selection as TEXT (the lines, as JSON): a list built on every
 * render is a new list every time, and a query keyed on one never settles.
 *
 * NOT kept under "sales", on purpose. A return that goes through invalidates
 * everything under that key at once — and this would ask again, for the lines
 * that had just gone back, and be told "only 0 left to return" while the
 * sheet was still closing. `already` (how many returns the sale has had) is
 * in the key instead: the next time the same lines are chosen it is a new
 * question, and is answered afresh.
 */
export function useReturnWorth(saleId: string | null, asked: string, already: number, open: boolean) {
  const items = JSON.parse(asked) as Array<{ sale_item_id: string; quantity: number }>;

  return useQuery({
    queryKey: ["return-worth", saleId, already, asked],
    queryFn: async () => (await salesService.returnWorth(saleId!, items)).data,
    enabled: open && !!saleId && items.length > 0,
    retry: false,
    gcTime: 0,
  });
}

export function useSaleMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sales"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    // A unit that is sold, voided or brought back is a unit whose NUMBER has
    // moved: on or off the shelf, on or off somebody's warranty.
    queryClient.invalidateQueries({ queryKey: ["product-serials"] });
    queryClient.invalidateQueries({ queryKey: ["warranty"] });
  };

  const create = useMutation({
    // The CALLER owns the idempotency key: one stable key per cart state
    // (see PosPage/NewSalePage idemRef), so a double-click or a retry after
    // a network error replays the same sale instead of creating a second
    // one. Never mint a key here — a fresh key per call defeats the dedupe.
    mutationFn: (payload: SaleInput) => salesService.create(payload),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason_code, reason }: { id: string; reason_code: VoidReasonCode; reason?: string }) =>
      salesService.cancel(id, reason_code, reason),
    onSuccess: invalidate,
  });

  const processReturn = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; items: Array<{ sale_item_id: string; quantity: number; serials?: string[] }>; reason?: string; refund_method?: string; idempotency_key?: string }) =>
      salesService.processReturn(id, payload),
    onSuccess: invalidate,
  });

  const exchange = useMutation({
    mutationFn: ({ id, ...payload }: {
      id: string;
      return_items: Array<{ sale_item_id: string; quantity: number; serials?: string[] }>;
      items: Array<{ product_id: string; variant_id?: string; quantity: number; serials?: string[] }>;
      payments?: Array<{ method: string; amount: number }>;
      channel?: string;
    }) => salesService.exchange(id, payload),
    onSuccess: invalidate,
  });

  return { create, cancel, processReturn, exchange };
}
