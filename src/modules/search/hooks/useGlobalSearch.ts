import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { searchService } from "../services/searchService";

/**
 * Global search (⌘K palette). Fires only once the query is 2+ characters —
 * matching the backend floor — and keeps the previous page's results on screen
 * while the next query resolves so the list doesn't flicker to empty.
 */
export function useGlobalSearch(query: string) {
  const q = query.trim();

  return useQuery({
    queryKey: ["global-search", q],
    queryFn: async () => (await searchService.query(q)).data,
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
