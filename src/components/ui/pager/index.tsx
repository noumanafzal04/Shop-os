import Button from "../button/Button";
import type { Pagination } from "../../../common/types/api";

/**
 * The one pager.
 *
 * ── What was actually wrong ─────────────────────────────────────────────
 *
 * Thirty-seven endpoints paginate. Fourteen screens had hand-written the same
 * fifteen lines to walk them, and **four had nothing at all** — so the rows on
 * page two were not merely awkward to reach, they were unreachable by any
 * means the product offered:
 *
 *   Coupons        30 a page, no search on the API either. A shop running
 *                  WhatsApp campaigns passes thirty in a season and then
 *                  cannot deactivate, expire or delete any of the rest.
 *   Owner reviews  TEN a page. A shop with eleven reviews can never read the
 *                  first one it ever got.
 *   Notifications  fifteen. Everything older is gone from the product.
 *   Transfers      twenty — and the hook took a page, and the service took a
 *                  page, and the screen called `useTransfers()` with nothing.
 *                  Built the whole way down and never wired.
 *
 * That last one is the argument for this file. Paging is not hard; it is
 * fifteen lines that every screen has to remember to write, and the ones that
 * forgot look exactly like the ones that had no rows to show.
 *
 * ── Why a component rather than a snippet to copy ───────────────────────
 *
 * The same reason there is one confirm dialog: fourteen copies of a rule are
 * not one rule. They had already drifted — some counted "items", some counted
 * nothing, one said "page 1 of 1" where the others hid.
 *
 * `reach.test.ts` beside this file is the half that keeps it true. A component
 * nobody is required to use is a component the fifteenth screen will not use.
 *
 * ── The empty case ──────────────────────────────────────────────────────
 *
 * Renders nothing when there is one page or none. A pager on a five-row table
 * is furniture, and a disabled Previous/Next pair reads as a broken control
 * rather than an absent one.
 */
interface PagerProps {
  /** Straight off `meta.pagination`. Undefined while the first page loads. */
  pagination?: Pagination | null;
  /** Called with the page to go to — never with a delta. */
  onPage: (page: number) => void;
  /**
   * What the rows ARE: "coupons", "reviews", "transfers".
   *
   * "42 items" is what every hand-written copy said, and it is the word a
   * developer reaches for when they have stopped thinking about the screen.
   * The shop is looking at suppliers, and the count should say so.
   */
  noun?: string;
}

export default function Pager({ pagination, onPage, noun = "items" }: PagerProps) {
  if (!pagination || pagination.last_page <= 1) return null;

  const { current_page: page, last_page: last, total } = pagination;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm sm:px-6 dark:border-gray-800">
      <span className="text-gray-500 dark:text-gray-400">
        {total} {noun} · page {page} of {last}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={page >= last} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
