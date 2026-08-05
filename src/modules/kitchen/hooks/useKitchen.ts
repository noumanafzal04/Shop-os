import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { kitchenService, type BumpStatus, type KitchenBoard } from "../services/kitchenService";

/**
 * Poll every 8 seconds.
 *
 * A cook never refreshes anything — hands are full — so the board has to come
 * to them. Eight seconds is under the time it takes to notice a new ticket has
 * not appeared, and slow enough that a busy kitchen with four screens open is
 * still only a couple of cheap queries a second.
 */
const POLL_MS = 8_000;

export function useKitchenBoard(params: { station?: string; includeServed?: boolean }) {
  return useQuery({
    queryKey: ["kitchen", "board", params.station ?? "all", params.includeServed ?? false],
    queryFn: async () =>
      (await kitchenService.board({ station: params.station, include_served: params.includeServed })).data,
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
export function useBumpKot(queryKey: readonly unknown[]) {
  const qc = useQueryClient();

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
              // Served tickets leave the default board entirely — dropping the
              // card is the honest optimistic result, not greying it out.
              kots: board.kots
                .map((k) => (k.id === id ? { ...k, status } : k))
                .filter((k) => k.status !== "served"),
            },
      );

      return { previous };
    },

    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
    },

    onSettled: () => qc.invalidateQueries({ queryKey: ["kitchen", "board"] }),
  });
}
