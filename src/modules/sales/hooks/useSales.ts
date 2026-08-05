import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { salesService, type VoidReasonCode } from "../services/salesService";
import type { SaleInput } from "../types";

export function useSales(params: { search?: string; status?: string; page?: number }) {
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

export function useSaleMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sales"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
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
    mutationFn: ({ id, ...payload }: { id: string; items: Array<{ sale_item_id: string; quantity: number }>; reason?: string; refund_method?: string; idempotency_key?: string }) =>
      salesService.processReturn(id, payload),
    onSuccess: invalidate,
  });

  const exchange = useMutation({
    mutationFn: ({ id, ...payload }: {
      id: string;
      return_items: Array<{ sale_item_id: string; quantity: number }>;
      items: Array<{ product_id: string; quantity: number }>;
      payments?: Array<{ method: string; amount: number }>;
      channel?: string;
    }) => salesService.exchange(id, payload),
    onSuccess: invalidate,
  });

  return { create, cancel, processReturn, exchange };
}
