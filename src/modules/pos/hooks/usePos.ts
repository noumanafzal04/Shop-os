import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../../common/types/api";
import { claimLocalHeld, holdLocally, isLocalHeld, localHeld, removeLocalHeld } from "../heldLocal";
import { closeShiftOffline, openShiftOffline, recordMovementOffline } from "../../offline/shift/offlineShift";
import { mirrorShift, mirroredShift } from "../../offline/shift/shiftMirror";
import { useAuthStore } from "../../../stores/authStore";
import { posService } from "../services/posService";
import { isCover } from "../services/posService";
import type { HeldSale, ManualMovementType, SessionState } from "../services/posService";

/**
 * Which shift is this till standing at?
 *
 * ── Why this one query is allowed to answer from the device ─────────────
 *
 * The POS disables Tender/Pay on `!open`. That gate had nothing behind it: no
 * query persistence anywhere in the app, and a service worker that caches
 * product images and no API responses. An outage with the page still mounted
 * sold fine — the query kept its last answer — but **a reload while offline
 * could not sell at all**, which is a tablet waking up, a PWA relaunch, or the
 * power cut the Help Centre names by name. The whole offline module sat behind
 * a gate that needed the server it was built to do without.
 *
 * ── Only silence falls back ─────────────────────────────────────────────
 *
 * `ApiError.status === 0` is the client's own discriminator for "we never
 * reached the server"; any real status means we did. A 401 must NOT produce a
 * remembered shift — that is a signed-out till being handed a drawer — and a
 * 500 means the shop's server is broken, which is a different conversation than
 * a dead line. Both still fail, loudly, as they did before.
 */
export function useCurrentSession() {
  return useQuery({
    queryKey: ["pos", "session"],
    queryFn: async () => {
      const tenantId = useAuthStore.getState().user?.tenant?.id ?? null;

      try {
        const session = (await posService.currentSession()).data;

        // Written on every answer, not only when the shift changes: an answer
        // is the only moment the device can be sure. `null` clears it — a
        // remembered shift the shop has since closed is worse than none, since
        // the till would go on selling into it.
        //
        // A COVER is deliberately not mirrored. It is a live arrangement
        // between two people that only the server can start or end, and a
        // remembered one would leave a reliever holding somebody else's drawer
        // after a reload with no way to hand it back. Covering while offline is
        // already refused; this keeps it refused across a restart.
        await mirrorShift(isCover(session) ? null : session, tenantId);

        return session;
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) {
          const remembered = await mirroredShift(tenantId);
          if (remembered !== null) return remembered as SessionState;
        }

        throw error;
      }
    },
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

  /**
   * Opening a shift, with or without a server.
   *
   * The offline path is not a convenience. A shop whose line is already down
   * when it opens could not start a shift at all, and with no shift the till
   * refuses to tender — so the entire offline module was unreachable on exactly
   * the morning it exists for.
   *
   * Only silence falls back. A refusal with a real status is the shop's own
   * server saying no — the lane is taken, this cashier already has a drawer
   * open elsewhere — and queueing past that would hand the cashier a shift the
   * shop has just declined to give them.
   */
  const open = useMutation({
    mutationFn: async ({ float, registerId, training }: {
      float: number;
      registerId?: string | null;
      training?: boolean;
    }) => {
      const tenantId = useAuthStore.getState().user?.tenant?.id ?? null;

      try {
        return await posService.openSession(float, registerId, training ?? false);
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) {
          const session = await openShiftOffline(float, registerId ?? null, training ?? false, tenantId);
          return { data: session } as Awaited<ReturnType<typeof posService.openSession>>;
        }

        throw error;
      }
    },
    onSuccess: invalidate,
  });
  // Handover — the same drawer, a different lane.
  const move = useMutation({
    mutationFn: (registerId: string) => posService.moveSession(registerId),
    onSuccess: invalidate,
  });
  /**
   * Counting the drawer out, with or without a server.
   *
   * A shift that ran through an outage could not be counted until the line came
   * back — and counting the drawer is the shop's own control over its own cash,
   * done at the moment the cashier hands over, not whenever the internet
   * returns. Only `counted_cash` is queued; every figure it is measured against
   * is the shop's arithmetic and is computed on arrival.
   */
  const close = useMutation({
    mutationFn: async ({ counted, notes, denominations, declared }: {
      counted: number;
      notes?: string;
      denominations?: Record<string, number>;
      declared?: Record<string, number>;
    }) => {
      const tenantId = useAuthStore.getState().user?.tenant?.id ?? null;

      try {
        return await posService.closeSession({
          counted_cash: counted,
          notes,
          denominations,
          declared_tenders: declared,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) {
          await closeShiftOffline(counted, notes ?? null, tenantId, denominations, declared);
          return { data: null } as never;
        }

        throw error;
      }
    },
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
    mutationFn: async (payload: { type: ManualMovementType; amount?: number; reason?: string; note?: string }) => {
      try {
        return await posService.recordMovement(payload);
      } catch (error) {
        // Money leaving or entering the drawer during an outage is still money
        // that moved. Refusing to record it means the cashier is short at close
        // with a paid-out slip and nothing in the system to point at.
        if (error instanceof ApiError && error.status === 0) {
          const tenantId = useAuthStore.getState().user?.tenant?.id ?? null;
          await recordMovementOffline(
            payload.type,
            payload.amount ?? null,
            payload.reason ?? null,
            payload.note ?? null,
            tenantId,
          );
          return { data: null } as never;
        }

        throw error;
      }
    },
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
    queryFn: async () => {
      const tenantId = useAuthStore.getState().user?.tenant?.id ?? null;
      const mine = localHeld(tenantId);

      try {
        // Both lists, always — a ticket parked on this till during an outage
        // must not vanish from the screen the moment the line comes back. It
        // is still sitting here, and it is still somebody's basket.
        return [...mine, ...(await posService.heldList()).data];
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) return mine;

        throw error;
      }
    },
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

  /**
   * Parking a basket, with or without a server.
   *
   * Offline the ticket is parked on THIS device and only this device can recall
   * it — the offline plan's "local only". It is never queued afterwards: a held
   * ticket is an intent, not money, and a queue could only flush once the line
   * returned, by which time the basket has usually been rung.
   */
  const hold = useMutation({
    mutationFn: async ({ offline, ...payload }: {
      label?: string;
      cart: HeldSale["cart"];
      total_estimate: number;
      /** The till already knows it has no line. See below. */
      offline?: boolean;
    }) => {
      const tenantId = () => useAuthStore.getState().user?.tenant?.id ?? null;

      // Asked for, not discovered. The catch below would park this ticket too,
      // but only after a 20-second request timeout — twenty seconds of a
      // cashier holding a queue while the till decides whether the internet is
      // there, when the till was already showing an offline pill.
      if (offline === true) return { data: holdLocally(payload, tenantId()) } as never;

      try {
        return await posService.hold(payload);
      } catch (error) {
        // The other half: the till believed it was connected and was not.
        if (error instanceof ApiError && error.status === 0) {
          return { data: holdLocally(payload, tenantId()) } as never;
        }

        throw error;
      }
    },
    onSuccess: invalidate,
  });
  /**
   * Resume by CLAIMING: the server hands back the cart and deletes the ticket
   * in one locked step, so a second lane that was a moment late is told the
   * ticket is gone instead of ringing the same basket again.
   */
  const claim = useMutation({
    mutationFn: async (id: string) => {
      // A locally parked ticket is claimed here, online or not: the server has
      // never heard of it, so asking would 404 on a basket that is sitting in
      // front of the cashier.
      if (isLocalHeld(id)) {
        const tenantId = useAuthStore.getState().user?.tenant?.id ?? null;
        const row = claimLocalHeld(id, tenantId);

        if (row === null) throw new ApiError("That ticket is no longer here.", 404);

        return { data: row } as never;
      }

      return posService.claimHeld(id);
    },
    onSuccess: invalidate,
    onError: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isLocalHeld(id)) {
        removeLocalHeld(id, useAuthStore.getState().user?.tenant?.id ?? null);

        return { data: null } as never;
      }

      return posService.deleteHeld(id);
    },
    onSuccess: invalidate,
  });
  return { hold, claim, remove };
}
