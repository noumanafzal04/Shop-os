import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { incomeService, type IncomeInput } from "../services/incomeService";

export function useIncomeCategories() {
  return useQuery({
    queryKey: ["income-categories"],
    queryFn: async () => (await incomeService.categories()).data,
  });
}

export function useIncomes(params: { search?: string; category_id?: string; page?: number }) {
  return useQuery({
    queryKey: ["incomes", params],
    queryFn: () => incomeService.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useIncomeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["incomes"] });
    queryClient.invalidateQueries({ queryKey: ["cashbook"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const create = useMutation({
    mutationFn: (payload: IncomeInput) => incomeService.create(payload),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & IncomeInput) =>
      incomeService.update(id, payload),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => incomeService.remove(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

export function useCashbook(params: { period: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ["cashbook", params],
    queryFn: async () => (await incomeService.cashbook(params)).data,
    placeholderData: keepPreviousData,
  });
}
