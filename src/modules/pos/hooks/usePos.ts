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

/**
 * The counter's shortlist. Rankings move over weeks, not minutes, so this is
 * cached hard — a till that re-fetches its quick keys on every focus is
 * spending a request to change nothing.
 */
export function useQuickKeys() {
  return useQuery({
    queryKey: ["pos", "quick-keys"],
    queryFn: async () => (await posService.quickKeys()).data,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
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
    mutationFn: ({ float, registerId, training }: {
      float: number;
      registerId?: string | null;
      training?: boolean;
    }) => posService.openSession(float, registerId, training ?? false),
    onSuccess: invalidate,
  });
  // Handover — the same drawer, a different lane.
  const move = useMutation({
    mutationFn: (registerId: string) => posService.moveSession(registerId),
    onSuccess: invalidate,
  });
  const close = useMutation({
    mutationFn: ({ counted, notes, denominations, declared }: {
      counted: number;
      notes?: string;
      denominations?: Record<string, number>;
      declared?: Record<string, number>;
    }) => posService.closeSession({
      counted_cash: counted,
      notes,
      denominations,
      declared_tenders: declared,
    }),
    onSuccess: invalidate,
  });
  return { open, move, close };
}

/**
 * Relief cover — holding a lane while its cashier is on a break.
 *
 * Invalidates the same keys as opening a shift, because from the till's point
 * of view it is the same event: who is standing here changed.
 */
export function useCoverMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pos", "session"] });
    qc.invalidateQueries({ queryKey: ["pos", "lanes"] });
  };

  const start = useMutation({
    mutationFn: (payload: { session_id?: string; reason?: string } = {}) =>
      posService.startCover(payload),
    onSuccess: invalidate,
  });
  const end = useMutation({
    mutationFn: () => posService.endCover(),
    onSuccess: invalidate,
  });

  return { start, end };
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
    // Held tickets are shared across the shop's lanes: a customer parked at
    // lane 1 walks to lane 3 and is picked up there. Without a poll, lane 1
    // keeps offering a ticket lane 3 already claimed, and the cashier who taps
    // it gets an error instead of a sale. Same seam as the kitchen and the
    // floor — two people, two browsers, neither able to invalidate the other.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
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
