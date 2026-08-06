import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { expensesService, type CategoryInput, type ExpenseInput, type RecurringInput } from "../services/expensesService";
import type { MoneyFilters } from "../services/moneyFilters";

export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => (await expensesService.categories()).data,
  });
}

export function useExpenses(filters: MoneyFilters) {
  return useQuery({
    queryKey: ["expenses", filters],
    queryFn: () => expensesService.list(filters),
    placeholderData: keepPreviousData,
  });
}

/**
 * Category management — the half of the module that was read-only until now.
 * The page has always said "yours to change"; this is what makes that true.
 */
export function useExpenseCategoryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expense-categories"] });
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
    // A retired category changes what the budget screen can even offer.
    queryClient.invalidateQueries({ queryKey: ["budgets"] });
  };

  return {
    create: useMutation({
      mutationFn: (payload: CategoryInput) => expensesService.createCategory(payload),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...payload }: { id: string } & CategoryInput) =>
        expensesService.updateCategory(id, payload),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => expensesService.removeCategory(id),
      onSuccess: invalidate,
    }),
  };
}

export function useExpenseMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    // A cash expense moves the drawer, so the till's own view of expected
    // cash is stale the moment one is filed.
    queryClient.invalidateQueries({ queryKey: ["pos"] });
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

  const attach = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => expensesService.attach(id, file),
    onSuccess: invalidate,
  });

  const detach = useMutation({
    mutationFn: (id: string) => expensesService.detach(id),
    onSuccess: invalidate,
  });

  return { create, update, remove, attach, detach };
}

/** Category ceilings for a month, with what has been spent against each. */
export function useBudgets(month?: string) {
  return useQuery({
    queryKey: ["expenses", "budgets", month ?? "current"],
    queryFn: async () => (await expensesService.budgets(month)).data,
  });
}

/**
 * Recurring templates. `due` narrows to the ones that have fallen due —
 * nothing posts itself, so this list is the whole prompt.
 */
export function useRecurringExpenses(due = false) {
  return useQuery({
    queryKey: ["expenses", "recurring", due],
    queryFn: async () => {
      const res = await expensesService.recurring(due);
      return { rows: res.data, dueCount: (res.meta as { due_count?: number })?.due_count ?? 0 };
    },
  });
}

export function useExpenseAdminMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
  };

  return {
    setBudget: useMutation({
      mutationFn: (payload: { expense_category_id: string; amount: number | null; month?: string }) =>
        expensesService.setBudget(payload),
      onSuccess: invalidate,
    }),
    createRecurring: useMutation({
      mutationFn: (payload: RecurringInput) => expensesService.createRecurring(payload),
      onSuccess: invalidate,
    }),
    removeRecurring: useMutation({
      mutationFn: (id: string) => expensesService.removeRecurring(id),
      onSuccess: invalidate,
    }),
    postRecurring: useMutation({
      mutationFn: ({ id, ...payload }: { id: string; amount?: number; payment_method?: string }) =>
        expensesService.postRecurring(id, payload),
      onSuccess: invalidate,
    }),
  };
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

export function useMarginsReport(period: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "margins", period],
    queryFn: async () => (await expensesService.marginsReport({ period })).data,
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** A snapshot of the shelves, not a period — no `period` in the key. */
export function useValuationReport(enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "valuation"],
    queryFn: async () => (await expensesService.valuationReport()).data,
    enabled,
  });
}

export function useDeadStockReport(days: number, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "dead-stock", days],
    queryFn: async () => (await expensesService.deadStockReport({ days })).data,
    enabled,
    placeholderData: keepPreviousData,
  });
}
