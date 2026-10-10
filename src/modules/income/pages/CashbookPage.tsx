import TableEmpty from "../../../components/ui/table/TableEmpty";
import { Link } from "react-router";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import { useCashbook } from "../hooks/useIncome";
import { formatEntryDate, formatRange } from "../../../components/ui/filters";
import { useKindOfBusiness } from "../../../common/tenant/kindOfBusiness";
import { ReportWindow } from "../../expenses/components/ReportWindow";
import { useReportWindow } from "../../expenses/hooks/useReportWindow";
import { rangeParams } from "../../expenses/reportPeriod";
import { cashbookShape } from "../cashbookShape";

/**
 * The cashbook: what each day came to.
 *
 * ── Two things it got wrong for the business that opens it most ──────
 *
 * A books-only business — a Finance Manager — has this as its front page, and
 * it was drawn for a shop. Seven columns, of which Sales and Refunds could
 * never hold a figure; a subtitle explaining that sales are counted
 * automatically; and a footnote sending the reader to "the POS shift close"
 * for their physical cash. Its shape is decided in `cashbookShape` now, from
 * what the business HAS, and tested there.
 *
 * And it could only be asked about four windows — today, this week, this
 * month, this year — on four buttons of its own, while the Reports tab beside
 * it took any range and knew the tax year. Same control now (`ReportWindow`),
 * so an accountant closing 1–15, last month or July-to-June can.
 */
export default function CashbookPage() {
  const money = useMoney();
  const when = useReportWindow();
  const cashbook = useCashbook(rangeParams(when.sent));
  const data = cashbook.data;
  const shape = cashbookShape(useKindOfBusiness());

  const totals = data?.totals;
  // The ledger opens on the same window this page is showing.
  const ledger = `/tenant/ledger?from=${when.sent.from}&to=${when.sent.to}`;

  return (
    <>
      <PageMeta title="Cashbook" description="Money in and out" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Cashbook</h2>
          <p className="max-w-2xl text-sm text-gray-500 dark:text-gray-400" data-testid="cashbook-says">
            {shape.says}
          </p>
          {shape.footnote && (
            <p className="mt-1 max-w-2xl text-theme-xs text-gray-400" data-testid="cashbook-footnote">
              {shape.footnote}
            </p>
          )}
          {/* The window in words: the control beside it can be on any range,
              and "which days is this?" should not need it opened to answer. */}
          <p className="mt-1 text-theme-xs font-medium text-gray-500 dark:text-gray-400" data-testid="cashbook-window">
            {when.invalid ? "Choose a range" : formatRange({ from: when.asked.from, to: when.asked.to })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={ledger}
            className="rounded-lg border border-gray-300 px-3 py-2 text-theme-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Open ledger
          </Link>
          <ReportWindow when={when} />
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* The split under each figure is only worth printing when there is
            more than one thing in it. */}
        <Card label="Money in" value={money(totals?.money_in ?? 0)} tone="in"
          sub={shape.splits ? `Sales ${money(totals?.sales_revenue ?? 0)} · Other ${money(totals?.other_income ?? 0)}` : undefined} />
        <Card label="Money out" value={money(totals?.money_out ?? 0)} tone="out"
          sub={shape.splits ? `Expenses ${money(totals?.expenses ?? 0)} · Refunds ${money(totals?.refunds ?? 0)}` : undefined} />
        <Card label="Net this period" value={money(totals?.net ?? 0)} tone={(totals?.net ?? 0) >= 0 ? "in" : "out"} />
        <Card label="Cumulative net" value={money(data?.closing_balance ?? 0)} tone="neutral"
          sub={`Since opening · was ${money(data?.opening_balance ?? 0)} before this period`} />
      </div>

      {/* Day-by-day ledger */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Date</th>
                {shape.columns.map((c) => (
                  <th key={c.key} className="px-6 py-3 font-medium text-right">{c.label}</th>
                ))}
                <th className="px-6 py-3 font-medium text-right">Net</th>
                <th className="px-6 py-3 font-medium text-right">Running net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {cashbook.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={shape.columns.length + 3} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : (data?.days ?? []).every((d) => d.money_in === 0 && d.money_out === 0) ? (
                <tr>
                  <TableEmpty from={cashbook} what="the cashbook" colSpan={shape.columns.length + 3} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    No money movement in this period yet.
                  </TableEmpty>
                </tr>
              ) : (
                (data?.days ?? [])
                  .filter((d) => d.money_in !== 0 || d.money_out !== 0)
                  .map((d) => (
                    <tr key={d.date} className="text-theme-sm text-gray-700 dark:text-gray-300">
                      <td className="px-6 py-4 font-medium">
                        {/* A day is a summary of entries; this is how you get
                            to them. Without it the figure is an answer nobody
                            can check, and checking is the whole job. */}
                        <Link
                          to={`/tenant/ledger?date=${d.date}`}
                          className="text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {formatEntryDate(d.date)}
                        </Link>
                      </td>
                      {shape.columns.map((c) => (
                        <td key={c.key} className="px-6 py-4 text-right">{d[c.key] ? money(d[c.key]) : "—"}</td>
                      ))}
                      <td className={`px-6 py-4 text-right font-medium ${d.net >= 0 ? "text-success-600 dark:text-success-500" : "text-error-500"}`}>
                        {money(d.net)}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-gray-800 dark:text-white/90">{money(d.balance)}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "in" | "out" | "neutral" }) {
  const color =
    tone === "in" ? "text-success-600 dark:text-success-500"
    : tone === "out" ? "text-error-500"
    : "text-gray-800 dark:text-white/90";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-theme-xs text-gray-400">{sub}</p>}
    </div>
  );
}
