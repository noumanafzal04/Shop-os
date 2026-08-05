import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../../common/types/api";
import { posService } from "../services/posService";
import type { HeldSale, ManualMovementType } from "../services/posService";

export function useCurrentSession() {
  return useQuery({
    queryKey: ["pos", "session"],
    queryFn: async () => (await posService.currentSession()).data,
  });
}

export function useShiftMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pos", "session"] });
    // Opening/closing/moving changes who is standing where, so the lane board
    // and the terminal's resolved hardware both go stale.
    qc.invalidateQueries({ queryKey: ["pos", "lanes"] });
    qc.invalidateQueries({ queryKey: ["pos", "terminal"] });
  };

  const open = useMutation({
    mutationFn: ({ float, registerId }: { float: number; registerId?: string | null }) =>
      posService.openSession(float, registerId),
    onSuccess: invalidate,
  });
  // Handover — the same drawer, a different lane.
  const move = useMutation({
    mutationFn: (registerId: string) => posService.moveSession(registerId),
    onSuccess: invalidate,
  });
  const close = useMutation({
    mutationFn: ({ counted, notes }: { counted: number; notes?: string }) => posService.closeSession(counted, notes),
    onSuccess: invalidate,
  });
  return { open, move, close };
}

/**
 * The X-read: what this drawer should hold right now.
 *
 * `enabled` is the caller's answer to "is a shift open AND is anyone looking" —
 * the endpoint 409s without a drawer, and the figure is worthless the moment a
 * sale is rung, so it is never served from cache (staleTime 0 → reopening the
 * panel refetches).
 */
export function useSessionReport(enabled: boolean) {
  return useQuery({
    queryKey: ["pos", "session", "report"],
    queryFn: async () => (await posService.sessionReport()).data,
    enabled,
    staleTime: 0,
  });
}

export function useCashMovementMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { type: ManualMovementType; amount?: number; reason?: string; note?: string }) =>
      posService.recordMovement(payload),
    // The prefix covers the X-read too, so the expected-cash figure the cashier
    // is held to updates the instant the movement lands.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos", "session"] }),
    onError: (e) => {
      // The drawer went away under us — closed on another terminal, or
      // force-closed by a manager. Refresh so the till stops offering cash
      // actions for a shift it no longer holds.
      if (e instanceof ApiError && e.errorCode === "SHIFT_REQUIRED") {
        qc.invalidateQueries({ queryKey: ["pos", "session"] });
      }
    },
  });
}

export function useHeldSales() {
  return useQuery({
    queryKey: ["pos", "held"],
    queryFn: async () => (await posService.heldList()).data,
  });
}

export function useHeldMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pos", "held"] });

  const hold = useMutation({
    mutationFn: (payload: { label?: string; cart: HeldSale["cart"]; total_estimate: number }) => posService.hold(payload),
    onSuccess: invalidate,
  });
  /**
   * Resume by CLAIMING: the server hands back the cart and deletes the ticket
   * in one locked step, so a second lane that was a moment late is told the
   * ticket is gone instead of ringing the same basket again.
   */
  const claim = useMutation({
    mutationFn: (id: string) => posService.claimHeld(id),
    onSuccess: invalidate,
    onError: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => posService.deleteHeld(id), onSuccess: invalidate });
  return { hold, claim, remove };
}
