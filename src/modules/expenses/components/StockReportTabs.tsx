import { useState } from "react";

import Button from "../../../components/ui/button/Button";
import Select from "../../../components/form/Select";
import { MetricCard, MetricCardSkeleton } from "../../../common/ui/MetricCard";
import { downloadFile } from "../../../common/api/download";
import { useToast } from "../../../components/ui/toast";
import { useMoney } from "../../shop/hooks/useShop";
import { useDeadStockReport, useMarginsReport, useValuationReport } from "../hooks/useExpenses";

/** A report you cannot take to an accountant is half a report. */
function ExportButton({ url, params, filename }: { url: string; params?: Record<string, unknown>; filename: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadFile(url, params, filename);
        } catch {
          toast.error("Couldn't build the file.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Preparing…" : "Export CSV"}
    </Button>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">{children}</p>
);

const Loading = () => (
  <div className="space-y-2 p-4">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
    ))}
  </div>
);

/**
 * What actually pays.
 *
 * A shop's best-selling line and its most profitable line are frequently not
 * the same item, and only one of those facts changes what to buy next.
 */
export function MarginsTab({ period }: { period: string }) {
  const money = useMoney();
  const report = useMarginsReport(period, true);
  const data = report.data;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4 md:gap-6">
        {report.isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard label="Revenue" value={money(data.totals.revenue)} />
            <MetricCard label="Cost of goods" value={money(data.totals.cogs)} />
            <MetricCard label="Profit" value={money(data.totals.profit)} />
            <MetricCard label="Margin" value={data.totals.margin_pct === null ? "—" : `${data.totals.margin_pct}%`} />
          </>
        )}
      </div>

      {data && data.losing.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-2xl border border-error-200 bg-error-50 dark:border-error-500/25 dark:bg-error-500/10">
          <div className="px-5 pb-2 pt-4">
            <h3 className="font-semibold text-error-700 dark:text-error-400">Sold below cost</h3>
            <p className="text-theme-xs text-error-600 dark:text-error-400/80">
              Almost always a costing mistake rather than a decision — and invisible in any report ranked by
              revenue.
            </p>
          </div>
          <table className="w-full text-left text-theme-sm">
            <tbody>
              {data.losing.map((row) => (
                <tr key={row.name} className="border-t border-error-200/60 dark:border-error-500/20">
                  <td className="px-5 py-2.5 text-gray-800 dark:text-white/90">{row.name}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {row.units} sold
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-medium text-error-600 dark:text-error-400">
                    {money(row.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-white/90">What earned the most</h3>
            <p className="text-theme-xs text-gray-400">Ranked by profit, not by revenue.</p>
          </div>
          <ExportButton url="/reports/margins/export" params={{ period }} filename={`margins-${period}.csv`} />
        </div>

        {report.isLoading ? (
          <Loading />
        ) : (data?.best ?? []).length === 0 ? (
          <Empty>No sales in this period.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-theme-sm">
              <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <tr>
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3 text-right">Units</th>
                  <th className="px-5 py-3 text-right">Revenue</th>
                  <th className="px-5 py-3 text-right">Profit</th>
                  <th className="px-5 py-3 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {(data?.best ?? []).map((row) => (
                  <tr key={row.name} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-5 py-2.5 text-gray-800 dark:text-white/90">{row.name}</td>
                    <td className="px-5 py-2.5 text-gray-500 dark:text-gray-400">{row.category}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{row.units}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {money(row.revenue)}
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right tabular-nums font-medium ${
                        row.profit < 0 ? "text-error-600 dark:text-error-400" : "text-gray-800 dark:text-white/90"
                      }`}
                    >
                      {money(row.profit)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {row.margin_pct === null ? "—" : `${row.margin_pct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** How much money the shop is standing in. */
export function ValuationTab() {
  const money = useMoney();
  const report = useValuationReport(true);
  const data = report.data;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4 md:gap-6">
        {report.isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard label="Value at cost" value={money(data.totals.cost_value)} />
            <MetricCard label="Value at retail" value={money(data.totals.retail_value)} />
            <MetricCard label="If it all sells" value={money(data.totals.potential_profit)} />
            <MetricCard label="Units on hand" value={data.totals.units} />
          </>
        )}
      </div>

      {data && data.totals.uncosted_items > 0 && (
        <div className="mb-6 rounded-xl border border-warning-200 bg-warning-50 p-3 text-theme-sm text-warning-700 dark:border-warning-500/25 dark:bg-warning-500/10 dark:text-warning-400">
          {data.totals.uncosted_items} {data.totals.uncosted_items === 1 ? "item has" : "items have"} no cost
          recorded ({data.totals.uncosted_units} units). They're counted at retail but not at cost, so the
          margin above is optimistic by whatever they actually cost.
        </div>
      )}

      <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="px-5 pb-3 pt-5">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">By category</h3>
        </div>
        {report.isLoading ? (
          <Loading />
        ) : (data?.by_category ?? []).length === 0 ? (
          <Empty>Nothing on the shelves.</Empty>
        ) : (
          <table className="w-full text-left text-theme-sm">
            <tbody>
              {(data?.by_category ?? []).map((row) => (
                <tr key={row.category} className="border-t border-gray-50 dark:border-gray-800/60">
                  <td className="px-5 py-2.5 text-gray-800 dark:text-white/90">{row.category}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
                    {row.units} units
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-800 dark:text-white/90">
                    {money(row.cost_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">Biggest holdings</h3>
          <ExportButton url="/reports/valuation/export" filename="stock-valuation.csv" />
        </div>
        {report.isLoading ? (
          <Loading />
        ) : (data?.items ?? []).length === 0 ? (
          <Empty>Nothing on the shelves.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-theme-sm">
              <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <tr>
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3 text-right">On hand</th>
                  <th className="px-5 py-3 text-right">Unit cost</th>
                  <th className="px-5 py-3 text-right">At cost</th>
                  <th className="px-5 py-3 text-right">At retail</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).slice(0, 100).map((row) => (
                  <tr key={`${row.product_id}-${row.variant_id ?? ""}`} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-5 py-2.5">
                      <span className="text-gray-800 dark:text-white/90">{row.name}</span>
                      {row.sku && <span className="ml-2 font-mono text-theme-xs text-gray-400">{row.sku}</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{row.quantity}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {row.cost === null ? <span className="text-warning-600">not costed</span> : money(row.cost)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-800 dark:text-white/90">
                      {money(row.cost_value)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {money(row.retail_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Stock nobody has bought.
 *
 * The quietest way a shop loses cash: nothing prompts you to look at a shelf
 * people don't buy from. It just sits there, already paid for.
 */
export function DeadStockTab() {
  const money = useMoney();
  const [days, setDays] = useState("90");
  const report = useDeadStockReport(Number(days), true);
  const data = report.data;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="w-48">
          <Select
            value={days}
            onChange={setDays}
            options={[
              { value: "30", label: "Nothing sold in 30 days" },
              { value: "60", label: "Nothing sold in 60 days" },
              { value: "90", label: "Nothing sold in 90 days" },
              { value: "180", label: "Nothing sold in 6 months" },
              { value: "365", label: "Nothing sold in a year" },
            ]}
          />
        </div>
        <ExportButton url="/reports/dead-stock/export" params={{ days }} filename={`dead-stock-${days}days.csv`} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4 md:gap-6">
        {report.isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard label="Cash tied up" value={money(data.totals.value)} />
            <MetricCard label="Lines" value={data.totals.lines} />
            <MetricCard label="Units" value={data.totals.units} />
            <MetricCard label="Never sold" value={data.totals.never_sold} />
          </>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        {report.isLoading ? (
          <Loading />
        ) : (data?.items ?? []).length === 0 ? (
          <Empty>Everything on the shelves has moved inside this window.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-theme-sm">
              <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <tr>
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3 text-right">On hand</th>
                  <th className="px-5 py-3 text-right">Tied up</th>
                  <th className="px-5 py-3 text-right">Last sold</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).slice(0, 200).map((row) => (
                  <tr key={`${row.product_id}-${row.sku ?? ""}`} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-5 py-2.5">
                      <span className="text-gray-800 dark:text-white/90">{row.name}</span>
                      {row.sku && <span className="ml-2 font-mono text-theme-xs text-gray-400">{row.sku}</span>}
                    </td>
                    <td className="px-5 py-2.5 text-gray-500 dark:text-gray-400">{row.category}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{row.quantity}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-medium text-gray-800 dark:text-white/90">
                      {money(row.value)}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-500 dark:text-gray-400">
                      {row.last_sold_at === null ? (
                        // A different problem from slow, and usually a buying
                        // mistake rather than a selling one.
                        <span className="text-error-600 dark:text-error-400">never</span>
                      ) : (
                        <>
                          {new Date(row.last_sold_at).toLocaleDateString()}
                          <span className="ml-2 text-theme-xs text-gray-400">{row.days_idle}d ago</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
