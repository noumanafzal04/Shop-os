import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { moneyService, type Commission, type ExpenseCategory, type NewExpense, type Period, type Summary } from "../services/moneyService";

export function useSummary(period: Period) {
  return useQuery({
    queryKey: ["summary", period],
    queryFn: async (): Promise<Summary> => (await moneyService.summary(period)).data,
    staleTime: 60_000,
  });
}

export function useCommission() {
  return useQuery({
    queryKey: ["commission"],
    queryFn: async (): Promise<Commission> => (await moneyService.commission()).data,
    staleTime: 5 * 60_000,
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense-categories"],
    queryFn: async (): Promise<ExpenseCategory[]> => (await moneyService.expenseCategories()).data,
    staleTime: 10 * 60_000,
  });
}

export function useRecordExpense() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (expense: NewExpense) => moneyService.recordExpense(expense),
    onSuccess: () => {
      // An expense moves three screens: this period's totals, today's figures
      // on the dashboard, and the cash the shop believes it is holding.
      void qc.invalidateQueries({ queryKey: ["summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
