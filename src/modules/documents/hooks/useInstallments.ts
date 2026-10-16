import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { installmentService, type InstallmentInput, type PlanFilter, type StartPlanInput } from "../services/installmentService";

const KEY = ["installments"] as const;

export function useInstallmentPlans(params: { status?: PlanFilter | ""; search?: string; page?: number }, enabled = true) {
  return useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: async () => {
      const res = await installmentService.list(params);
      return { rows: res.data, pagination: res.meta?.pagination };
    },
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInstallmentSummary(enabled = true) {
  return useQuery({ queryKey: [...KEY, "summary"], queryFn: async () => (await installmentService.summary()).data, enabled });
}

export function useInstallmentPlan(id: string | null) {
  return useQuery({ queryKey: [...KEY, "plan", id], queryFn: async () => (await installmentService.show(id!)).data, enabled: id !== null });
}

/**
 * An installment takes money off a khata — into a drawer when it is cash — so
 * it refreshes the plans, the customer book, the day's collections, the
 * reports and the dashboard. Starting a plan also rings a sale (the shelf,
 * the sales list) and books the installment charge as income.
 */
export function useInstallmentMutations() {
  const qc = useQueryClient();
  const refresh = (keys: string[][]) => {
    for (const queryKey of [[...KEY], ["customers"], ["pos", "day"], ["pos", "days"], ["pos", "session"], ["reports"], ["dashboard"], ...keys]) void qc.invalidateQueries({ queryKey });
  };

  const start = useMutation({
    mutationFn: (p: StartPlanInput) => installmentService.start(p),
    onSuccess: () => refresh([["sales"], ["products"], ["inventory"], ["incomes"]]),
  });
  const pay = useMutation({ mutationFn: ({ id, ...p }: { id: string } & InstallmentInput) => installmentService.pay(id, p), onSuccess: () => refresh([]) });

  return { start, pay };
}
