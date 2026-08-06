import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dayService, type DepositInput } from "../services/dayService";
import { useAuthStore } from "../../../stores/authStore";

/** A trading day is drawers, so it belongs to shops that actually have a till. */
function useTillShop() {
  const role = useAuthStore((s) => s.user?.role);
  const hasPos = !!useAuthStore((s) => s.user?.tenant?.features?.pos);
  return (role === "shop_owner" || role === "staff") && hasPos;
}

/**
 * The day currently trading.
 *
 * Polled, because the point of the screen is watching the day build while
 * three lanes are still selling — a figure that only moves on reload is one
 * nobody trusts.
 */
export function useCurrentDay() {
  return useQuery({
    queryKey: ["pos", "day"],
    queryFn: async () => (await dayService.current()).data,
    enabled: useTillShop(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useDayHistory(params: { from?: string; to?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ["pos", "days", params],
    queryFn: () => dayService.history(params),
    enabled: useTillShop(),
  });
}

export function useDayDetail(id: string | null) {
  return useQuery({
    queryKey: ["pos", "days", "detail", id],
    queryFn: async () => (await dayService.show(id!)).data,
    enabled: !!id,
  });
}

export function useDeposits(params: { from?: string; to?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ["pos", "deposits", params],
    queryFn: () => dayService.deposits(params),
    enabled: useTillShop(),
  });
}

export function useDayMutations() {
  const qc = useQueryClient();
  // Banking and closing both change what the day reads, and the day is the
  // screen someone is looking at when they do either.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pos", "day"] });
    qc.invalidateQueries({ queryKey: ["pos", "days"] });
    qc.invalidateQueries({ queryKey: ["pos", "deposits"] });
  };

  return {
    close: useMutation({
      mutationFn: ({ id, notes }: { id: string; notes?: string }) => dayService.close(id, notes),
      onSuccess: invalidate,
    }),
    deposit: useMutation({
      mutationFn: (payload: DepositInput) => dayService.recordDeposit(payload),
      onSuccess: invalidate,
    }),
  };
}
