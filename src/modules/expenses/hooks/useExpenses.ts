import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { expensesService, type ExpenseInput } from "../services/expensesService";

export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => (await expensesService.categories()).data,
  });
}

export function useExpenses() {
  return useQuery({
    queryKey: ["expenses"],
    queryFn: () => expensesService.list({}),
  });
}

export function useExpenseMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const create = useMutation({
    mutationFn: (payload: ExpenseInput) => expensesService.create(payload),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => expensesService.remove(id),
    onSuccess: invalidate,
  });

  return { create, remove };
}
