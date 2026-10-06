import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  kitchenService,
  type BoardView,
  type BumpStatus,
  type ClearScope,
  type KitchenBoard,
} from "../services/kitchenService";

/**
 * Poll every 8 seconds.
 *
 * A cook never refreshes anything — hands are full — so the board has to come
 * to them. Eight seconds is under the time it takes to notice a new ticket has
 * not appeared, and slow enough that a busy kitchen with four screens open is
 * still only a couple of cheap queries a second.
 */
const POLL_MS = 8_000;

const boardKey = (view: BoardView) => ["kitchen", "board", view] as const;

/**
 * The WHOLE board, every station.
 *
 * The station used to go to the server, so picking "Grill" fetched the grill
 * and nothing else — and the screen then had no idea how many tickets the bar
 * was holding, or whether to show a count beside its tab at all. A board is a
 * few dozen rows on its worst night; it is fetched once and narrowed here, so
 * switching station is instant and every tab can say how much is on it.
 */
export function useKitchenBoard(view: BoardView) {
  return useQuery({
    queryKey: boardKey(view),
    queryFn: async () => (await kitchenService.board(view)).data,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    // The board is never "stale" in a useful sense — it's a live queue.
    staleTime: 0,
  });
}

/**
 * Bump a ticket forward, optimistically.
 *
 * On shop wifi a round trip can take a second, and a cook who taps "Ready" and
 * sees nothing happen taps it again. The card moves immediately and rolls back
 * if the server disagrees.
 */
export function useBumpKot(view: BoardView) {
  const qc = useQueryClient();
  const queryKey = boardKey(view);

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: BumpStatus }) => kitchenService.bump(id, status),

    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<KitchenBoard>(queryKey);

      qc.setQueryData<KitchenBoard>(queryKey, (board) =>
        board === undefined
          ? board
          : {
              ...board,
              // Served tickets leave the working board entirely — dropping the
              // card is the honest optimistic result, not greying it out. The
              // served view keeps it: that view is where it now belongs.
              kots: board.kots
                .map((k) => (k.id === id ? { ...k, status } : k))
                .filter((k) => view === "served" || k.status !== "served"),
            },
      );

      return { previous };
    },

    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["kitchen", "board"] });
      // The floor shows the same status per line. In a small shop one person
      // works both screens on one device, and there the poll is a wait for
      // nothing — the answer is already known the moment the bump returns.
      // Across devices the floor's own poll still carries it.
      qc.invalidateQueries({ queryKey: ["dine-in"] });
    },
  });
}

/**
 * Take tickets off the board in one go.
 *
 * Not optimistic, on purpose. A bump is one card the cook is looking at; this
 * is a count the screen was TOLD, and if the server clears a different number
 * — somebody else served two in the meantime — the screen should say the
 * number that actually went.
 */
export function useClearBoard() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ scope, station }: { scope: ClearScope; station?: string }) =>
      kitchenService.clear(scope, station),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchen", "board"] });
      // A cleared docket changes what the tab says about its lines, and what
      // the dashboard says the kitchen still owes.
      qc.invalidateQueries({ queryKey: ["dine-in"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
