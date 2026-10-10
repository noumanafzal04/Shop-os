import type { ReactNode } from "react";

import { emptyBecause, type Asked } from "../../components/ui/table/TableEmpty";
import { CouldNotLoad } from "./CouldNotLoad";
import { NoAccess } from "./NoAccess";

/**
 * WHICH "NOTHING" THIS IS — for a list that is not a table.
 *
 * The sibling of <TableEmpty>, for cards, tiles, panels and the lists inside
 * a dialog. Every one of them gets to its empty state the same way a table
 * does — `rows.length === 0`, with rows being `data ?? []` — and so every one
 * of them drew "No categories yet", "No riders yet", "Nothing on the pass"
 * over a request that had been refused or had failed. The kitchen's is the
 * sharpest: its empty state is a tick and "all caught up", which is what a
 * board that could not be read would have shown a cook.
 *
 * Wrap the empty state in it, and say which query it is the empty state of:
 *
 *   {rows.length === 0 ? (
 *     <ListEmpty from={riders} what="the riders">
 *       <p>No riders yet — add your first.</p>
 *     </ListEmpty>
 *   ) : …}
 *
 * Refused → <NoAccess>. Failed → <CouldNotLoad>, with Try again. Otherwise
 * the children, untouched — and only ever otherwise when the list has data:
 * see `emptyBecause`.
 *
 * `emptyIsNotFailed.test.ts` holds every list that waits on a query to using
 * this or <TableEmpty>.
 */
export function ListEmpty({
  from,
  what,
  children,
}: {
  /** The query this is the empty state of. */
  from: Asked;
  /** What it fetches, lower case: "the riders". */
  what: string;
  children: ReactNode;
}) {
  const { denied, failed } = emptyBecause(from);

  if (denied !== null) return <NoAccess reason={denied} what={what} />;
  if (failed !== null) {
    return <CouldNotLoad what={what} why={failed} onRetry={() => void from.refetch()} busy={from.isFetching} />;
  }

  return <>{children}</>;
}
