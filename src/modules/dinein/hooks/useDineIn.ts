import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dineInService,
  type AddItemLine,
  type SettlePayload,
} from "../services/dineInService";

/**
 * How often the floor asks the server what changed.
 *
 * The floor and the pass are two screens in two different hands, and neither
 * can invalidate the other's cache — a waiter's browser knows nothing about the
 * cook tapping "ready". Until there is a socket, polling IS the link between
 * them, so it has to be at least as quick as the kitchen's own 8s or the pass
 * moves and the floor does not.
 */
const FLOOR_POLL_MS = 8_000;

export function useTables() {
  return useQuery({
    queryKey: ["dine-in", "tables"],
    queryFn: async () => (await dineInService.tables()).data,
    // The floor is live — occupancy changes when anyone seats or settles.
    refetchInterval: FLOOR_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** Every tab still open — the picker for "merge this into that". */
export function useOpenTickets(enabled = true) {
  return useQuery({
    queryKey: ["dine-in", "open-tickets"],
    queryFn: async () => (await dineInService.openTickets()).data,
    enabled,
    // A tab someone else settled must stop being offered as a merge target.
    refetchOnWindowFocus: true,
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: ["dine-in", "ticket", id],
    queryFn: async () => (await dineInService.ticket(id as string)).data,
    enabled: !!id,
    // The open tab carries kot_status per line — "with the kitchen", "ready to
    // run", "served". That status is written by the KITCHEN, in a different
    // browser, so nothing on this screen invalidates it: without a poll the
    // waiter watched a tab that said "with the kitchen" while the food sat
    // under the lamp going cold, and only a manual refresh moved it. Firing
    // looked live purely because the waiter's own mutation invalidated it.
    refetchInterval: FLOOR_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Who a table can be handed to. Loaded only when the hand-over is actually
 * opened — a floor screen refreshing every few seconds has no business
 * re-fetching the roster with it.
 */
export function useServers(enabled = false) {
  return useQuery({
    queryKey: ["dine-in", "servers"],
    queryFn: async () => (await dineInService.servers()).data,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDineInMutations(ticketId?: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dine-in", "tables"] });
    if (ticketId) qc.invalidateQueries({ queryKey: ["dine-in", "ticket", ticketId] });
  };

  const openTicket = useMutation({
    mutationFn: (payload: Parameters<typeof dineInService.openTicket>[0]) => dineInService.openTicket(payload),
    onSuccess: invalidate,
  });

  const addItems = useMutation({
    mutationFn: ({ id, items }: { id: string; items: AddItemLine[] }) => dineInService.addItems(id, items),
    onSuccess: invalidate,
  });

  const voidItem = useMutation({
    mutationFn: ({ id, itemId, reason }: { id: string; itemId: string; reason?: string }) =>
      dineInService.voidItem(id, itemId, reason),
    onSuccess: invalidate,
  });

  const fire = useMutation({
    mutationFn: ({ id, itemIds }: { id: string; itemIds?: string[] }) => dineInService.fire(id, itemIds),
    onSuccess: invalidate,
  });

  const settle = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SettlePayload }) => dineInService.settle(id, payload),
    onSuccess: () => {
      invalidate();
      // Settling is the moment a tab becomes a SALE: the dishes leave stock and
      // their recipes draw down ingredients. Only this one of the dine-in
      // mutations moves the shelf — opening a tab and firing a docket do not —
      // so the invalidation sits here rather than on the shared helper.
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const move = useMutation({
    mutationFn: ({ id, dining_table_id, guest_count }: { id: string; dining_table_id: string | null; guest_count?: number }) =>
      dineInService.move(id, { dining_table_id, guest_count }),
    onSuccess: invalidate,
  });

  const merge = useMutation({
    mutationFn: ({ id, sourceId }: { id: string; sourceId: string }) => dineInService.merge(id, sourceId),
    onSuccess: () => {
      invalidate();
      // The absorbed tab is now closed, so any open-tab list holding it is wrong.
      qc.invalidateQueries({ queryKey: ["dine-in", "open-tickets"] });
    },
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => dineInService.cancel(id, reason),
    onSuccess: invalidate,
  });

  /**
   * A section changing hands at shift change. Also invalidates the open-tab
   * list, because a tab that is no longer yours must leave your floor view —
   * otherwise the waiter who gave it away still sees it and is refused on the
   * next tap.
   */
  const assignWaiter = useMutation({
    mutationFn: ({ id, waiterId }: { id: string; waiterId: string }) =>
      dineInService.assignWaiter(id, waiterId),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["dine-in", "open-tickets"] });
    },
  });

  const createTable = useMutation({
    mutationFn: (payload: { name: string; seats?: number; area?: string }) => dineInService.createTable(payload),
    onSuccess: invalidate,
  });

  const deleteTable = useMutation({
    mutationFn: (tableId: string) => dineInService.deleteTable(tableId),
    onSuccess: invalidate,
  });

  const reorderTables = useMutation({
    mutationFn: (order: string[]) => dineInService.reorderTables(order),
    onSuccess: invalidate,
  });

  return { openTicket, addItems, voidItem, fire, settle, move, merge, cancel, assignWaiter, createTable, deleteTable, reorderTables };
}
