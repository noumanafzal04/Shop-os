import { formatEntryDate } from "../../../components/ui/filters";
import TableEmpty from "../../../components/ui/table/TableEmpty";
import Pager from "../../../components/ui/pager";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import type { Pagination } from "../../../common/types/api";

/**
 * One line of a book, in the shape both sides of it share.
 *
 * Expenses and income were two hand-written tables with the same eight columns
 * and a different opinion about every one of them — one wrote the ISO date and
 * the other wrote the ISO date, one had an "Actions" header and the other had
 * a blank one, one gave the amount no weight at all and the other coloured it.
 * They are the same list twice and they now render through the same component,
 * so the next change lands on both or on neither.
 */
export interface MoneyEntryView {
  id: string;
  /** `yyyy-mm-dd` or an ISO timestamp — never a Date; see formatEntryDate. */
  date: string;
  title: string;
  /** Bill number, who was paid, whether a schedule posted it. */
  meta?: React.ReactNode;
  category: string | null;
  branch?: string | null;
  method: string | null;
  /** This entry really moved cash through an open drawer. */
  toTill?: boolean;
  amount: string | number;
  attachmentUrl?: string | null;
}

interface Props {
  rows: MoneyEntryView[];
  loading: boolean;
  money: (n: string | number) => string;
  /** `out` is a cost, `in` is a receipt — it decides how the amount is tinted. */
  direction: "in" | "out";
  showBranch: boolean;
  pagination?: Pagination;
  onPage: (page: number) => void;
  noun: string;
  /** What to say when there is nothing — the two reasons differ. */
  empty: { filtered: boolean; title: string; hint: string; action?: React.ReactNode };
  /**
   * The order the server is honouring, and how to ask for another.
   *
   * Both lists sort server-side and neither table ever asked, so a merchant
   * hunting the biggest bill of the quarter read four pages by eye. Passed
   * together or not at all — a header that looks sortable and is not is worse
   * than a plain one.
   */
  sort?: { key: string; dir: "asc" | "desc"; onSort: (key: "date" | "amount") => void };
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAttach: (id: string) => void;
  onView: (url: string) => void;
  onDetach: (id: string) => void;
}

/**
 * Columns fall away as the page narrows rather than pushing the table sideways.
 *
 * The rail takes 290px from `lg`, so a 1024px tablet has LESS page than a
 * 768px phone held in landscape — which is why the widest set is gated on `xl`
 * and not on `lg`. Nothing that disappears is lost: category and method are
 * repeated into the meta line under the title at exactly the widths that drop
 * their columns.
 */
const WIDE = "hidden xl:table-cell";
const MEDIUM = "hidden sm:table-cell";

export function MoneyEntryTable({
  rows,
  loading,
  money,
  direction,
  showBranch,
  pagination,
  onPage,
  noun,
  empty,
  sort,
  onEdit,
  onDelete,
  onAttach,
  onView,
  onDetach,
}: Props) {
  const columns = 6 + (showBranch ? 1 : 0);
  const amountTint =
    direction === "out"
      ? "text-gray-900 dark:text-white"
      : "text-success-600 dark:text-success-500";

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-200 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
              <SortHead label="Date" column="date" sort={sort} className={MEDIUM} />
              <th className="px-3 py-3 sm:px-5 font-medium">Description</th>
              <th className={`px-3 py-3 sm:px-5 font-medium ${MEDIUM}`}>Category</th>
              {showBranch && <th className={`px-3 py-3 sm:px-5 font-medium ${WIDE}`}>Branch</th>}
              <th className={`px-3 py-3 sm:px-5 font-medium ${WIDE}`}>Method</th>
              <SortHead label="Amount" column="amount" sort={sort} align="right" />
              <th className={`px-3 py-3 sm:px-5 text-center font-medium ${MEDIUM}`}>Receipt</th>
              {/* `relative`, and it is not decoration.
                  `sr-only` is `position: absolute`, so without a positioned
                  ancestor this span's containing block is the page itself —
                  which puts it OUTSIDE the scroll container's clipping chain.
                  At 390px the table lays out 477px wide inside a 356px
                  scroller, the span sits at x=474, and one invisible pixel of
                  helper text pushed the whole page 84px sideways. */}
              <th className="relative px-3 py-3 sm:px-5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={columns + 2} className="px-3 py-4 sm:px-5">
                    <div className="h-6 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <TableEmpty colSpan={columns + 2} className="px-3 py-16 sm:px-5">
                  <div className="mx-auto max-w-sm text-center">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{empty.title}</p>
                    <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">{empty.hint}</p>
                    {empty.action && <div className="mt-4 flex justify-center">{empty.action}</div>}
                  </div>
                </TableEmpty>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="text-theme-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.02]"
                >
                  <td className={`whitespace-nowrap px-3 py-3.5 tabular-nums text-gray-500 sm:px-5 dark:text-gray-400 ${MEDIUM}`}>
                    {formatEntryDate(row.date)}
                  </td>

                  <td className="px-3 py-3.5 sm:px-5">
                    <p className="font-medium text-gray-800 dark:text-white/90">{row.title}</p>
                    {/* Everything the narrow layouts drop, plus what never had
                        a column of its own. One muted line, so the title stays
                        the thing the eye lands on. */}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-theme-xs text-gray-400">
                      <span className="font-medium text-gray-500 sm:hidden dark:text-gray-400">
                        {formatEntryDate(row.date)}
                      </span>
                      <span className="sm:hidden">{row.category ?? "Uncategorised"}</span>
                      <span className="xl:hidden">{methodLabel(row.method)}</span>
                      {row.meta}
                    </p>
                  </td>

                  <td className={`px-3 py-3.5 sm:px-5 ${MEDIUM}`}>
                    {row.category === null ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span className="inline-block max-w-[12rem] truncate rounded-full bg-gray-100 px-2.5 py-1 text-theme-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
                        {row.category}
                      </span>
                    )}
                  </td>

                  {showBranch && (
                    <td className={`px-3 py-3.5 sm:px-5 text-theme-xs ${WIDE}`}>{row.branch ?? "—"}</td>
                  )}

                  <td className={`whitespace-nowrap px-3 py-3.5 sm:px-5 ${WIDE}`}>
                    <span className="text-theme-xs text-gray-500 dark:text-gray-400">
                      {methodLabel(row.method)}
                    </span>
                    {row.toTill && <TillBadge />}
                  </td>

                  <td className={`whitespace-nowrap px-3 py-3.5 sm:px-5 text-right text-theme-sm font-semibold tabular-nums ${amountTint}`}>
                    {money(row.amount)}
                  </td>

                  <td className={`px-3 py-3.5 sm:px-5 text-center ${MEDIUM}`}>
                    {row.attachmentUrl ? (
                      <span className="inline-flex items-center">
                        <button
                          type="button"
                          className={ROW_ACTION}
                          aria-label={`View the receipt on ${row.title}`}
                          title="View receipt"
                          onClick={() => onView(row.attachmentUrl!)}
                        >
                          <Clip className="text-brand-500" />
                        </button>
                        <button
                          type="button"
                          className={ROW_ACTION_DANGER}
                          aria-label={`Remove the receipt on ${row.title}`}
                          title="Remove receipt"
                          onClick={() => onDetach(row.id)}
                        >
                          <Cross />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={ROW_ACTION}
                        aria-label={`Attach a receipt to ${row.title}`}
                        title="Attach a receipt"
                        onClick={() => onAttach(row.id)}
                      >
                        <Clip className="text-gray-400 dark:text-gray-500" />
                      </button>
                    )}
                  </td>

                  <td className="px-3 py-3.5 sm:px-5 text-right">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className={ROW_ACTION}
                        aria-label={`Edit ${row.title}`}
                        onClick={() => onEdit(row.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={ROW_ACTION_DANGER}
                        aria-label={`Delete ${row.title}`}
                        onClick={() => onDelete(row.id)}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pager pagination={pagination} onPage={onPage} noun={noun} />
    </div>
  );
}

function SortHead({
  label,
  column,
  sort,
  align = "left",
  className: extra = "",
}: {
  label: string;
  column: "date" | "amount";
  sort: Props["sort"];
  align?: "left" | "right";
  className?: string;
}) {
  const className = `px-3 py-3 font-medium sm:px-5 ${align === "right" ? "text-right" : ""} ${extra}`;

  if (!sort) return <th className={className}>{label}</th>;

  const active = sort.key === column;

  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => sort.onSort(column)}
        aria-label={`Sort by ${label.toLowerCase()}`}
        className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-1 uppercase tracking-wide transition-colors hover:text-gray-600 dark:hover:text-gray-300 ${
          active ? "text-brand-600 dark:text-brand-400" : ""
        }`}
      >
        {label}
        {/* Held in the layout whether or not it is this column's turn, so the
            header does not jump sideways when the order changes. */}
        <span aria-hidden className={active ? "" : "opacity-0"}>
          {sort.dir === "desc" ? "\u2193" : "\u2191"}
        </span>
      </button>
    </th>
  );
}

/** `bank_transfer` is not a word. */
function methodLabel(method: string | null): string {
  if (!method) return "—";

  return method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, " ");
}

const TillBadge = () => (
  <span
    title="This moved cash through an open drawer, and the shift knows about it"
    className="ml-1.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
  >
    till
  </span>
);

const Clip = ({ className = "" }: { className?: string }) => (
  <svg className={`h-4 w-4 ${className}`} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path
      d="M13.5 7.5 8.2 12.8a1.9 1.9 0 0 0 2.7 2.7l5.6-5.6a3.5 3.5 0 0 0-5-5l-5.6 5.6a5.1 5.1 0 0 0 7.2 7.2l4.4-4.4"
      transform="translate(-1.5 -2)"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Cross = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
