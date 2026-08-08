import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { expensesService, type CategoryInput, type ExpenseInput, type RecurringInput } from "../services/expensesService";
import type { ReportRange } from "../reportPeriod";
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
    // Prefix match: this also covers ["expenses", "budgets", month] — a
    // retired category changes what the budget screen can even offer.
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
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
    // An expense is half of the cashbook's money-out. Everything else this
    // entry touches was refreshed and the day summary was not, so filing a
    // bill and opening the Cashbook showed yesterday's figure.
    queryClient.invalidateQueries({ queryKey: ["cashbook"] });
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
  // Posting a recurring bill files a REAL expense — one that can move the
  // drawer. Refreshing only the expense list and the reports left the ledger,
  // the cashbook and the till showing a figure that had already changed.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
    queryClient.invalidateQueries({ queryKey: ["cashbook"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    queryClient.invalidateQueries({ queryKey: ["pos"] });
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
    // Rent goes from 40k to 45k. Without this the only way to say so was to
    // delete the template and build it again, losing the schedule with it.
    updateRecurring: useMutation({
      mutationFn: ({ id, ...payload }: { id: string } & Partial<RecurringInput>) =>
        expensesService.updateRecurring(id, payload),
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

/**
 * Every report is keyed by the WHOLE window, not by the period name. Two
 * custom ranges are two different reports, and a key of "custom" would serve
 * the second one the first one's answer.
 */
export function useReport(range: ReportRange) {
  return useQuery({
    queryKey: ["reports", "summary", range],
    queryFn: async () => (await expensesService.report(range)).data,
    placeholderData: keepPreviousData,
  });
}

export function usePurchasesReport(range: ReportRange, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "purchases", range],
    queryFn: async () => (await expensesService.purchasesReport(range)).data,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useStaffReport(range: ReportRange, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "staff", range],
    queryFn: async () => (await expensesService.staffReport(range)).data,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useTaxReport(range: ReportRange, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "tax", range],
    queryFn: async () => (await expensesService.taxReport(range)).data,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useMarginsReport(range: ReportRange, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "margins", range],
    queryFn: async () => (await expensesService.marginsReport(range)).data,
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
