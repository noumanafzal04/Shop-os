import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { incomeService, type IncomeInput } from "../services/incomeService";
import { ledgerService, type LedgerFilters } from "../services/ledgerService";
import type { CategoryInput } from "../../expenses/services/expensesService";
import type { MoneyFilters } from "../../expenses/services/moneyFilters";

export function useIncomeCategories() {
  return useQuery({
    queryKey: ["income-categories"],
    queryFn: async () => (await incomeService.categories()).data,
  });
}

export function useIncomes(filters: MoneyFilters) {
  return useQuery({
    queryKey: ["incomes", filters],
    queryFn: () => incomeService.list(filters),
    placeholderData: keepPreviousData,
  });
}

/**
 * The ledger — every movement, balance carried down. Kept on its own key so a
 * new expense refreshes it without dragging the whole cashbook with it.
 */
export function useLedger(filters: LedgerFilters) {
  return useQuery({
    queryKey: ["ledger", filters],
    queryFn: () => ledgerService.list(filters),
    placeholderData: keepPreviousData,
  });
}

/** Category management, the half of the module that was read-only until now. */
export function useIncomeCategoryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["income-categories"] });
    queryClient.invalidateQueries({ queryKey: ["incomes"] });
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
  };

  return {
    create: useMutation({
      mutationFn: (payload: CategoryInput) => incomeService.createCategory(payload),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...payload }: { id: string } & CategoryInput) =>
        incomeService.updateCategory(id, payload),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => incomeService.removeCategory(id),
      onSuccess: invalidate,
    }),
  };
}

export function useIncomeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["incomes"] });
    queryClient.invalidateQueries({ queryKey: ["cashbook"] });
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    // Cash income lands in the open drawer, so the till's expected cash is
    // stale the moment one is filed — the expense half already did this.
    queryClient.invalidateQueries({ queryKey: ["pos"] });
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
