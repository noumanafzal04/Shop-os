import Badge from "../../../../components/ui/badge/Badge";
import { DollarLineIcon, FileIcon } from "../../../../icons";
import type { RecentExpenseRow, RecentSaleRow } from "../../types";
import { EmptyPanel, SectionCard, SkeletonBar } from "./SectionCard";
import { formatDate, formatDateTime } from "./format";

// gray-400 on white is 2.5:1 — a column heading nobody over forty can read in
// shop light. gray-500/gray-400 is the secondary-text pair that clears 4.5:1
// on both grounds.
const HEAD =
  "px-5 py-3 text-left text-theme-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400";
const CELL = "px-5 py-3.5 text-theme-sm text-gray-600 dark:text-gray-300";
const ROW = "transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]";

/** Sale statuses come straight from the SaleStatus enum. */
function saleBadge(status: string) {
  const color =
    status === "completed"
      ? "success"
      : status === "cancelled"
        ? "error"
        : status === "refunded" || status === "partially_refunded"
          ? "warning"
          : "light";

  return (
    <Badge size="sm" color={color}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

interface SalesProps {
  rows: RecentSaleRow[];
  money: (n: string | number) => string;
  /** The Sales ledger link, when this tenant has one. */
  to?: string;
}

export function RecentSalesCard({ rows, money, to }: SalesProps) {
  return (
    <SectionCard
      title="Recent sales"
      icon={<DollarLineIcon className="size-5" />}
      to={rows.length > 0 ? to : undefined}
      flush
    >
      {rows.length === 0 ? (
        <div className="px-5 pb-5 sm:px-6">
          <EmptyPanel
            message="No sales recorded yet."
            hint="The last few tickets show up here as they are rung."
          />
        </div>
      ) : (
        <div className="custom-scrollbar overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50/70 dark:border-gray-800 dark:bg-white/[0.02]">
                <th className={HEAD}>Invoice</th>
                <th className={HEAD}>Customer</th>
                <th className={`${HEAD} text-right`}>Total</th>
                <th className={HEAD}>Status</th>
                <th className={HEAD}>When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((row) => (
                <tr key={row.id} className={ROW}>
                  <td className={`${CELL} whitespace-nowrap font-medium text-gray-800 dark:text-white/90`}>
                    {row.invoice_number}
                  </td>
                  <td className={`${CELL} max-w-[180px] truncate`}>{row.customer}</td>
                  <td className={`${CELL} whitespace-nowrap text-right font-semibold tabular-nums text-gray-800 dark:text-white/90`}>
                    {money(row.total)}
                  </td>
                  <td className={`${CELL} whitespace-nowrap`}>{saleBadge(row.status)}</td>
                  <td className={`${CELL} whitespace-nowrap tabular-nums`}>{formatDateTime(row.sold_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

interface ExpensesProps {
  rows: RecentExpenseRow[];
  money: (n: string | number) => string;
  to?: string;
}

export function RecentExpensesCard({ rows, money, to }: ExpensesProps) {
  return (
    <SectionCard
      title="Recent expenses"
      icon={<FileIcon className="size-5" />}
      to={rows.length > 0 ? to : undefined}
      flush
    >
      {rows.length === 0 ? (
        <div className="px-5 pb-5 sm:px-6">
          <EmptyPanel
            message="No expenses recorded yet."
            hint="Log one and it appears here with its category."
          />
        </div>
      ) : (
        <div className="custom-scrollbar overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50/70 dark:border-gray-800 dark:bg-white/[0.02]">
                <th className={HEAD}>Category</th>
                <th className={HEAD}>Paid for</th>
                <th className={HEAD}>Date</th>
                <th className={`${HEAD} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((row) => (
                <tr key={row.id} className={ROW}>
                  <td className={`${CELL} whitespace-nowrap`}>
                    <Badge size="sm" color="light">
                      {row.category}
                    </Badge>
                  </td>
                  <td className={`${CELL} max-w-[220px] truncate text-gray-800 dark:text-white/90`}>
                    {row.payee ?? row.description ?? "—"}
                  </td>
                  <td className={`${CELL} whitespace-nowrap tabular-nums`}>{formatDate(row.date)}</td>
                  <td className={`${CELL} whitespace-nowrap text-right font-semibold tabular-nums text-gray-800 dark:text-white/90`}>
                    {money(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/** Table skeleton — same header chip, same column rhythm as the real thing. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="flex items-center gap-3">
        <SkeletonBar className="size-9 rounded-xl" />
        <SkeletonBar className="h-4 w-32" />
      </div>
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <SkeletonBar className="h-3 flex-1" />
            <SkeletonBar className="h-3 w-16" />
            <SkeletonBar className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </section>
  );
}
