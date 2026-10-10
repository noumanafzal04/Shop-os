import { ReactNode } from "react";

import { deniedReason, loadFailure } from "../../../common/api/denied";
import { CouldNotLoad } from "../../../common/ui/CouldNotLoad";
import { NoAccess } from "../../../common/ui/NoAccess";

/**
 * The cell a list draws when it has nothing to draw.
 *
 * ── Why it is a component and not a `<td className="text-center">` ───────
 *
 * Because that is what it was, in two dozen places, and on a phone the
 * sentence was off the side of the screen. Measured at 390px:
 *
 *   /tenant/purchases  "No purchase orders yet."   ran to 474px
 *   /tenant/customers  "No customers yet — …"      ran to 485px
 *   /tenant/coupons    "No coupons yet."           ran to 402px
 *
 * Every list on the site is a table inside `overflow-x-auto`, and the table
 * carries `min-w-[48rem]` so its columns stay readable. `text-center` on a
 * cell that spans that table centres the message at 384px — in a window 390px
 * wide. What the shop sees is an empty white box, with the sentence explaining
 * why sitting off to the right, in a container they have no reason to think
 * scrolls at all. Every one of these screens passed on desktop, which is where
 * they were looked at.
 *
 * ── How it is centred in the WINDOW instead of the table ────────────────
 *
 * `max-w-[100cqi]`, and the useful part is what happens when there is NO
 * container: a container query length falls back to the small viewport's
 * inline size. So this is one line rather than two dozen wrapper edits.
 *
 *   phone    `w-full` is 768 (the table's min width) → clamped to 390 → the
 *            text centres at 195px, on screen.
 *   desktop  `w-full` is ~940 (the card) → 100cqi is 1280 → no clamp → the
 *            message centres in the card exactly as it always did.
 *
 * Where `cqi` is not understood the declaration is simply invalid, the block
 * falls back to `w-full`, and the screen behaves as it does today. There is no
 * version of this that is worse than what it replaces.
 *
 * `sticky left-0` is the smaller half: if the shop HAS scrolled the table
 * sideways, the message follows rather than sliding away.
 *
 * It renders the `<td>` only. The `<tr>` stays at the call site, because some
 * of these rows carry a key, a colour or a click and none of that is this
 * component's business.
 *
 * ── A list with nothing to draw has THREE reasons, and this said one ────
 *
 * Every list reaches this cell the same way: `rows.length === 0`. And rows
 * are `data ?? []` — so the cell was also what a list drew when it had been
 * REFUSED (403) and when its request had FAILED (the server slowing somebody
 * down, an error on its side, an answer that never came). Two dozen screens
 * said "No customers yet", "No suppliers yet", "No purchase orders yet" over a
 * request that had gone wrong. The till was the first place this was seen —
 * a cashier told the shop had no products — and it was fixed there, on its
 * own; every other list still did it.
 *
 * So the cell is told which query it is the empty state OF (`from`), and
 * answers for all three:
 *
 *   refused   <NoAccess>      — a permission, or a module the shop has not got
 *   failed    <CouldNotLoad>  — said out loud, with Try again
 *   empty     the children    — what the caller wrote, as before
 *
 * Only when there is no data at all. A list that HAS rows and whose refresh
 * failed is still a list with rows, and a filter that matches none of them is
 * still "nothing matches" — the truth about what is on screen.
 *
 * `emptyIsNotFailed.test.ts` holds every use of this cell to passing `from`.
 */

/** The part of a query's result this needs. Any react-query result has it. */
export interface Asked {
  error: unknown;
  data: unknown;
  isFetching: boolean;
  refetch: () => unknown;
}

/** Which of the three it is. Exported for the one caller that draws its own table-less state. */
export function emptyBecause(from: Asked | undefined): { denied: "permission" | "module" | null; failed: string | null } {
  if (!from || from.data !== undefined) return { denied: null, failed: null };

  return { denied: deniedReason(from.error), failed: loadFailure(from.error) };
}
export default function TableEmpty({
  colSpan,
  className = "",
  children,
  from,
  what = "this list",
}: {
  colSpan: number;
  /** The cell's own padding, size and colour. The positioning is not negotiable. */
  className?: string;
  children: ReactNode;
  /** The query this is the empty state of. Left out only by a cell that is not one — "Loading…". */
  from?: Asked;
  /** What was being fetched, lower case: "the customer list". */
  what?: string;
}) {
  const { denied, failed } = emptyBecause(from);

  if (denied !== null || failed !== null) {
    return (
      <td colSpan={colSpan} className="p-0">
        {/* Its own padding, not the caller's: the caller's was chosen for one
            line of grey text. And NARROWER than the line's block by the
            page's gutters: a sentence centred in a block 34px wider than the
            card is 17px off and nobody sees it, but this is a bordered box —
            on a phone its right edge was outside the card, cut off. */}
        <div className="sticky left-0 w-full max-w-[calc(100cqi_-_2.5rem)] px-3 py-6 sm:px-6">
          {denied !== null ? (
            <NoAccess reason={denied} what={what} />
          ) : (
            <CouldNotLoad what={what} why={failed} onRetry={() => void from!.refetch()} busy={from!.isFetching} />
          )}
        </div>
      </td>
    );
  }

  return (
    <td colSpan={colSpan} className="p-0">
      <div className={`sticky left-0 w-full max-w-[100cqi] ${className}`}>{children}</div>
    </td>
  );
}
