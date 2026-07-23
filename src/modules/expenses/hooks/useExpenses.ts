import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { expensesService, type ExpenseInput } from "../services/expensesService";

export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => (await expensesService.categories()).data,
  });
}

export function useExpenses(params: { search?: string; category_id?: string; page?: number }) {
  return useQuery({
    queryKey: ["expenses", params],
    queryFn: () => expensesService.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useExpenseMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
  };

  const create = useMutation({
    mutationFn: (payload: ExpenseInput) => expensesService.create(payload),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & ExpenseInput) =>
      expensesService.update(id, payload),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => expensesService.remove(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

export function useReport(params: { period: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ["reports", params],
    queryFn: async () => (await expensesService.report(params)).data,
    placeholderData: keepPreviousData,
  });
}

export function usePurchasesReport(period: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "purchases", period],
    queryFn: async () => (await expensesService.purchasesReport({ period })).data,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useStaffReport(period: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "staff", period],
    queryFn: async () => (await expensesService.staffReport({ period })).data,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useTaxReport(period: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "tax", period],
    queryFn: async () => (await expensesService.taxReport({ period })).data,
    enabled,
    placeholderData: keepPreviousData,
  });
}
