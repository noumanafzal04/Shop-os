import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { salesService, type Sale, type SaleQuery } from "../services/salesService";

/**
 * THE LEDGER, A PAGE AT A TIME.
 *
 * `useInfiniteQuery` rather than a page number in state, because this list is
 * read by scrolling and a shop with eight hundred sales a month is the normal
 * case rather than the edge one.
 *
 * ── The stop condition is the SERVER's ───────────────────────────────
 *
 * `last_page` from the envelope's pagination, not "the page came back short".
 * A short page is also what a filter returning few rows looks like, and a
 * list that stops early on that reading simply hides sales.
 */
export function useSalesList(q: Omit<SaleQuery, "page">) {
  return useInfiniteQuery({
    queryKey: ["sales", q],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => salesService.list({ ...q, page: pageParam }),
    getNextPageParam: (last) => {
      const p = last.meta.pagination;
      if (!p) return undefined;
      return p.current_page < p.last_page ? p.current_page + 1 : undefined;
    },
    staleTime: 30_000,
  });
}

export function useSale(id: string) {
  return useQuery({
    queryKey: ["sale", id],
    queryFn: async (): Promise<Sale> => (await salesService.show(id)).data,
    staleTime: 60_000,
  });
}
