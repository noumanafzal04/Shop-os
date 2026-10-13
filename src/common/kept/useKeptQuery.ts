import { useQuery, type QueryKey, type UseQueryResult } from "@tanstack/react-query";

import { useAuthStore } from "../../stores/authStore";
import { believedAt, heldFor, ownerOf, stillStands } from "./kept";
import { useKeptStore } from "./keptStore";

interface KeptQuery<T> {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  /** How long an answer is trusted. A screen opening inside it asks nothing. */
  staleTime: number;
  enabled?: boolean;
  refetchInterval?: number;
  refetchOnWindowFocus?: boolean;
  /**
   * False for a variant of the query that is not worth keeping — an older
   * page of a list, say. It is then an ordinary query: asked, and forgotten.
   */
  kept?: boolean;
}

/** Who is signed in at this instant — read where an answer is asked for, not where it is shown. */
const ownerNow = (): string | null => {
  const { user } = useAuthStore.getState();

  return ownerOf(user?.tenant?.id, user?.id);
};

/**
 * A query whose last answer stays on the device — see `kept.ts`.
 *
 * It behaves exactly as `useQuery` does, with one difference: it starts from
 * what this person was last told, aged honestly. Inside `staleTime` that IS
 * the answer and the server is not asked; past it the kept answer is shown at
 * once and the fresh one replaces it when it arrives.
 *
 * Everything that refreshes a query still does — `invalidateQueries` after a
 * save, `refetchInterval`, a manual refetch, the server's stamp moving
 * (`shellStamp.ts`) — and whatever comes back is kept in its turn.
 *
 * ── An answer is kept for whoever ASKED ──────────────────────────────
 *
 * The till lets a second person take over with a PIN, without a reload, and
 * the query cache is not emptied when they do. Keeping "whatever the query
 * holds" under "whoever is signed in" would file the first person's bell
 * under the second's name. So the answer is written down inside the asking
 * itself, under the person whose token asked.
 *
 * `name` is the answer's place in the record. Two queries that share a name
 * would read each other's answer, so each caller has its own.
 */
export function useKeptQuery<T>(name: string, { kept = true, queryFn, ...options }: KeptQuery<T>): UseQueryResult<T> {
  const owner = useAuthStore((s) => ownerOf(s.user?.tenant?.id, s.user?.id));
  const held = useKeptStore((s) => (kept ? heldFor(s.record, owner, name) : null));
  // Read where the query is made, not subscribed to: a stamp that moves while
  // the screen is open is acted on by `heardShellStamp`, which refreshes the
  // query itself. This only decides how a NEW query opens.
  const standing = (under: string | null | undefined): boolean => {
    const record = useKeptStore.getState().record;

    return stillStands(under, record !== null && record.owner === owner ? record.stamp : null);
  };

  return useQuery<T>({
    ...options,
    queryFn: async () => {
      const asker = ownerNow();
      const answer = await queryFn();
      if (kept && asker !== null) useKeptStore.getState().keep(asker, name, answer, Date.now());

      return answer;
    },
    enabled: (options.enabled ?? true) && owner !== null,
    initialData: held !== null ? (held.data as T) : undefined,
    // An answer heard under a stamp the server has since moved on from is
    // shown and asked about at once, however recent: something it is made
    // of has changed, and the asking that followed did not get through.
    initialDataUpdatedAt: () => (held === null ? undefined : standing(held.under) ? believedAt(held.at, Date.now()) : 0),
  });
}
