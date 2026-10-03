import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiEnvelope } from "@cartze/core/types/api";
import { notificationService, type AppNotification } from "../services/notificationService";

/**
 * THE FEED, A PAGE AT A TIME — and the unread count that comes with it.
 *
 * The server puts `unread_count` in the envelope's meta on every page, and it
 * counts ALL unread rather than the unread on this page. Read from page ONE
 * for that reason: later pages carry the same total, and taking it from
 * whichever page happened to load last would be the same number by luck.
 */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: ["notifications"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => notificationService.list(pageParam),
    getNextPageParam: (last) => {
      const p = last.meta.pagination;
      if (!p) return undefined;
      return p.current_page < p.last_page ? p.current_page + 1 : undefined;
    },
    staleTime: 30_000,
  });
}

export function unreadCount(pages: ReadonlyArray<ApiEnvelope<unknown>> | undefined): number {
  // `ApiMeta` is an index signature, so the value arrives as `unknown` — a
  // cast would be the lie. Narrowed instead, and a server that stops sending
  // it reads as zero rather than as NaN in a badge.
  const n = pages?.[0]?.meta.unread_count;
  return typeof n === "number" ? n : 0;
}

/**
 * Marking one read.
 *
 * ── Optimistic, and it has to be ─────────────────────────────────────
 *
 * The row is tapped to OPEN it. Waiting for a round trip before the dot
 * disappears means the dot is still there while the next screen is already
 * drawing, and the shopkeeper taps it again.
 *
 * The rollback is the whole cost of being optimistic and it is paid here
 * rather than left out: a failed call puts the dot back, so "read" never
 * means "the request was sent".
 */
export function useMarkRead() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => notificationService.markRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const previous = qc.getQueryData(["notifications"]);

      qc.setQueryData(["notifications"], (old: any) => {
        if (!old?.pages) return old;
        const now = new Date().toISOString();
        return {
          ...old,
          pages: old.pages.map((page: any, i: number) => ({
            ...page,
            // The count lives on page one only — see `unreadCount`.
            meta:
              i === 0
                ? { ...page.meta, unread_count: Math.max(0, (page.meta.unread_count ?? 1) - 1) }
                : page.meta,
            data: page.data.map((n: AppNotification) =>
              n.id === id && n.read_at == null ? { ...n, read_at: now } : n,
            ),
          })),
        };
      });

      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(["notifications"], ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
