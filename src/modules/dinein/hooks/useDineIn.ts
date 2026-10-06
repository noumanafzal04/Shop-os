import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dineInService,
  type AddItemLine,
  type SettlePayload,
  type Ticket,
  type TicketItem,
} from "../services/dineInService";
import { joinable } from "../tabLines";

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

/**
 * The floor screen's one payload: tables, takeaway tabs, and what each has
 * reached. Polled at the same rate as the tables, for the same reason — the
 * kitchen marking a docket ready happens in another browser, and "Food ready"
 * on a tile is only worth drawing if it arrives while the food is still hot.
 */
export function useFloor() {
  return useQuery({
    queryKey: ["dine-in", "floor"],
    queryFn: async () => (await dineInService.floor()).data,
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

/**
 * ORDERING, ONE REQUEST AT A TIME, WITHOUT MAKING THE WAITER WAIT.
 *
 * ── What it replaces ─────────────────────────────────────────────────
 *
 * Every tap on a dish sent "add a line of one", and the whole menu was
 * disabled until the answer came back. So eight naan was eight taps, each
 * waiting on the one before, ending in eight rows — and on shop wifi a tap
 * that landed while the menu was greyed out was simply lost.
 *
 * ── How it works ─────────────────────────────────────────────────────
 *
 * Taps are QUEUED, never refused. Each one is decided when its turn comes,
 * against the tab as the server last described it: if there is an unsent line
 * of exactly this order it is stepped up by one, otherwise a new line is
 * added. Deciding at the moment of the tap would have had eight taps all
 * looking at a tab with no naan on it, and adding eight lines.
 *
 * Every answer is the whole tab, and is written straight into the cache — the
 * screen does not ask again for what it has just been told.
 *
 * `waiting` is how many taps on each dish are still in the queue, so a menu
 * tile can count up the instant it is pressed rather than a round trip later.
 */
export function useTabLines(ticketId: string | undefined) {
  const qc = useQueryClient();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [waiting, setWaiting] = useState<Record<string, number>>({});

  const key = ["dine-in", "ticket", ticketId] as const;

  const hold = useCallback((dish: string, by: number) => {
    setWaiting((w) => {
      const next = { ...w, [dish]: Math.max(0, (w[dish] ?? 0) + by) };
      if (next[dish] === 0) delete next[dish];

      return next;
    });
  }, []);

  /** Run after everything already asked for. A failure does not jam what follows it. */
  const inTurn = useCallback(<T,>(dish: string, job: () => Promise<{ data: Ticket } & T>) => {
    hold(dish, 1);
    const mine = queue.current.then(job).then((res) => {
      // The mutation answers with the tab and its lines, and nothing about
      // who is serving it. Keep what the screen already knew of that.
      qc.setQueryData<Ticket>(key, (prev) =>
        prev ? { ...prev, ...res.data, waiter: res.data.waiter ?? prev.waiter } : res.data,
      );
      // The floor's tile for this table says "order not sent" and what it has
      // reached; both just changed.
      qc.invalidateQueries({ queryKey: ["dine-in", "floor"] });

      return res;
    }).finally(() => hold(dish, -1));
    queue.current = mine.catch(() => undefined);

    return mine;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, hold, qc]);

  const add = useCallback((line: AddItemLine) => {
    const id = ticketId as string;

    return inTurn(line.product_id, () => {
      const lines = qc.getQueryData<Ticket>(key)?.items ?? [];
      // A note makes it its own line: it was said about this one.
      const into = line.note ? null : joinable(lines, line);

      return into
        ? dineInService.updateItem(id, into.id, { adjust: line.quantity })
        : dineInService.addItems(id, [line]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, inTurn, qc]);

  const step = useCallback((item: TicketItem, by: number) =>
    inTurn(item.product_id ?? item.id, () => dineInService.updateItem(ticketId as string, item.id, { adjust: by })),
  [ticketId, inTurn]);

  const note = useCallback((item: TicketItem, text: string) =>
    inTurn(item.product_id ?? item.id, () => dineInService.updateItem(ticketId as string, item.id, { note: text })),
  [ticketId, inTurn]);

  return { add, step, note, waiting, busy: Object.keys(waiting).length > 0 };
}

export function useDineInMutations(ticketId?: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dine-in", "tables"] });
    // The floor screen reads its own payload now; the table list above is the
    // tab workspace's move picker. Both describe the same floor.
    qc.invalidateQueries({ queryKey: ["dine-in", "floor"] });
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

  /**
   * Close what an earlier service left open. Everything about the floor is
   * stale afterwards — and so is the kitchen, whose dockets went with them.
   */
  const closeOlderTabs = useMutation({
    mutationFn: () => dineInService.closeOlderTabs(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dine-in"] });
      qc.invalidateQueries({ queryKey: ["kitchen", "board"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return {
    openTicket, addItems, voidItem, fire, settle, move, merge, cancel, assignWaiter,
    createTable, deleteTable, reorderTables, closeOlderTabs,
  };
}
