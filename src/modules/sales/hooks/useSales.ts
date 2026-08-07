import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { salesService } from "../services/salesService";
import type { SaleInput } from "../types";

function makeIdempotencyKey(): string {
  return `mob-sale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useSales(params: { search?: string; page?: number }) {
  return useQuery({
    queryKey: ["sales", params],
    queryFn: () => salesService.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useSaleMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sales"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const create = useMutation({
    mutationFn: (payload: SaleInput) =>
      salesService.create({ idempotency_key: makeIdempotencyKey(), ...payload }),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      salesService.cancel(id, reason),
    onSuccess: invalidate,
  });

  return { create, cancel };
}
