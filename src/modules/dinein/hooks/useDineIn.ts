import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dineInService,
  type AddItemLine,
  type SettlePayload,
} from "../services/dineInService";

export function useTables() {
  return useQuery({
    queryKey: ["dine-in", "tables"],
    queryFn: async () => (await dineInService.tables()).data,
    // The floor is live — refresh occupancy every 15s.
    refetchInterval: 15_000,
  });
}

/** Every tab still open — the picker for "merge this into that". */
export function useOpenTickets(enabled = true) {
  return useQuery({
    queryKey: ["dine-in", "open-tickets"],
    queryFn: async () => (await dineInService.openTickets()).data,
    enabled,
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: ["dine-in", "ticket", id],
    queryFn: async () => (await dineInService.ticket(id as string)).data,
    enabled: !!id,
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
    onSuccess: invalidate,
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

  const createTable = useMutation({
    mutationFn: (payload: { name: string; seats?: number; area?: string }) => dineInService.createTable(payload),
    onSuccess: invalidate,
  });

  const deleteTable = useMutation({
    mutationFn: (tableId: string) => dineInService.deleteTable(tableId),
    onSuccess: invalidate,
  });

  return { openTicket, addItems, voidItem, fire, settle, move, merge, cancel, createTable, deleteTable };
}
