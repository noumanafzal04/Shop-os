import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { registerService, type RegisterPayload } from "../services/registerService";
import { useAuthStore } from "../../../stores/authStore";
import { useTerminalStore } from "../../../stores/terminalStore";

/** Manager list: every lane, with who is on it. */
export function useRegisters() {
  const role = useAuthStore((s) => s.user?.role);
  const hasPos = !!useAuthStore((s) => s.user?.tenant?.features?.pos);
  return useQuery({
    queryKey: ["registers"],
    queryFn: async () => (await registerService.list()).data,
    enabled: (role === "shop_owner" || role === "staff") && hasPos,
  });
}

/** Cashier lane picker: active lanes at this branch, with live busy status. */
export function useLanes(enabled = true) {
  return useQuery({
    queryKey: ["pos", "lanes"],
    queryFn: async () => (await registerService.lanes()).data,
    enabled,
    // Another lane can be claimed at any moment; keep the picker honest.
    //
    // staleTime alone did not do that — it only says a cached answer may be
    // reused, and with nothing triggering a refetch the picker sat on a lane
    // map from whenever the screen opened. A cashier then picked a lane that
    // was already taken and met REGISTER_BUSY, which reads as a bug rather
    // than as somebody else being on it.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * What this terminal is. Re-fetched when the device's lane changes, since the
 * resolved hardware follows the lane.
 */
export function useTerminal(enabled = true) {
  const registerId = useTerminalStore((s) => s.activeRegisterId);
  return useQuery({
    queryKey: ["pos", "terminal", registerId],
    queryFn: async () => (await registerService.terminal()).data,
    enabled,
  });
}

export function useRegisterMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["registers"] });
    qc.invalidateQueries({ queryKey: ["pos", "lanes"] });
  };

  return {
    create: useMutation({ mutationFn: (p: RegisterPayload) => registerService.create(p), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...p }: { id: string } & Partial<RegisterPayload>) => registerService.update(id, p),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => registerService.remove(id), onSuccess: invalidate }),
    forceClose: useMutation({
      mutationFn: ({ registerId, counted_cash, notes }: { registerId: string; counted_cash: number; notes?: string }) =>
        registerService.forceClose(registerId, counted_cash, notes),
      onSuccess: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: ["pos", "shift-day"] });
      },
    }),
  };
}

/**
 * Every shift in a date range, across lanes and across days.
 *
 * Distinct from the business-day view, which is organised by trading day: this
 * is organised by DRAWER, so it answers "how has Lane 3 been counting out this
 * week" and "which of Adeel's shifts came up short". It is also the only place
 * a training shift appears at all — those belong to no business day.
 */
export function useShiftDay(
  params?: { from?: string; to?: string; register_id?: string },
  enabled = true,
) {
  const role = useAuthStore((s) => s.user?.role);
  return useQuery({
    queryKey: ["pos", "shift-day", params],
    queryFn: async () => (await registerService.shiftDay(params)).data,
    enabled: enabled && (role === "shop_owner" || role === "staff"),
  });
}
