import { useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import PageMeta from "../../../components/common/PageMeta";
import Alert from "../../../components/ui/alert/Alert";
import { MetricCard, MetricCardSkeleton } from "../../../common/ui/MetricCard";
import { usePurchasesReport, useReport, useStaffReport, useTaxReport } from "../hooks/useExpenses";
import { ReprintReportTab } from "../../receipts/components/ReprintReportTab";
import { DeadStockTab, MarginsTab, ValuationTab } from "../components/StockReportTabs";
import { useAuthStore } from "../../../stores/authStore";
import { reportTabs, shopSells, SALES_TABS, STOCK_TABS } from "../reportTabs";


const PERIODS = [
  ["daily", "Today"],
  ["weekly", "This Week"],
  ["monthly", "This Month"],
  ["yearly", "This Year"],
] as const;

export default function ReportsPage() {
  const money = useMoney();
  const features = useAuthStore((s) => s.user?.tenant?.features);
  const tracksStock = !!features?.inventory;
  // A books-only business (Finance Manager) sells nothing and stocks nothing.
  // Which tabs that leaves is decided in reportTabs, where it can be tested.
  const sells = shopSells(features);
  const [period, setPeriod] = useState<string>("monthly");
  const [selectedTab, setTab] = useState<string>("overview");
  // A shop can lose a module while someone is sitting on the tab it fed.
  // Falling back beats rendering a tab whose every request now 403s.
  const unavailable = (STOCK_TABS.includes(selectedTab) && !tracksStock)
    || (SALES_TABS.includes(selectedTab) && !sells);
  const tab = unavailable ? "overview" : selectedTab;
  const report = useReport({ period });

  const TABS = reportTabs(features);

  const data = report.data;

  const chartOptions: ApexOptions = {
    chart: { type: "area", toolbar: { show: false }, fontFamily: "Outfit, sans-serif" },
    colors: ["#465fff", "#f04438"],
    stroke: { curve: "smooth", width: 2 },
    fill: { type: "gradient", gradient: { opacityFrom: 0.35, opacityTo: 0 } },
    dataLabels: { enabled: false },
    xaxis: {
      categories: (data?.series ?? []).map((b) => b.date),
      labels: { style: { colors: "#98a2b3" } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { style: { colors: "#98a2b3" } } },
    grid: { borderColor: "#f2f4f7", strokeDashArray: 4 },
    legend: { labels: { colors: "#667085" } },
    tooltip: { y: { formatter: (v: number) => money(v) } },
  };

  // A flat zero revenue line under a real expense line is not a comparison,
  // it is a line the reader has to work out is meaningless.
  const chartSeries = [
    ...(sells ? [{ name: "Revenue", data: (data?.series ?? []).map((b) => b.revenue) }] : []),
    { name: "Expenses", data: (data?.series ?? []).map((b) => b.expenses) },
  ];

  return (
    <>
      <PageMeta title="Reports | ShopOS" description="Business performance" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Reports</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {data ? `${data.period.from} → ${data.period.to}` : "Performance summary"}
          </p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setPeriod(value)}
              className={`rounded-lg border px-4 py-2 text-sm transition ${
                period === value
                  ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10"
                  : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Report tabs */}
      <div className="mb-6 flex gap-2 border-b border-gray-200 dark:border-gray-800">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
              tab === value
                ? "border-brand-500 font-medium text-brand-600 dark:text-brand-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {report.isError && (
        <div className="mb-6">
          <Alert variant="error" title="Couldn't load report" message="Check your connection and try again." />
        </div>
      )}

      {tab === "margins" ? <MarginsTab period={period} /> : tab === "valuation" ? <ValuationTab /> : tab === "dead-stock" ? <DeadStockTab /> : tab === "purchases" ? <PurchasesTab period={period} /> : tab === "staff" ? <StaffTab period={period} /> : tab === "tax" ? <TaxTab period={period} /> : tab === "receipts" ? <ReprintReportTab period={period} /> : (
      <>
      {/* Totals. A shop that sells nothing is shown what it actually has —
          money out and what that leaves — not four cards of Rs 0 padding out
          a row. Net profit stays either way: for a books-only business it is
          simply the other side of what they spent. */}
      <div
        className={`mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6 ${
          sells ? "xl:grid-cols-6" : "sm:grid-cols-2"
        }`}
      >
        {report.isLoading || !data ? (
          Array.from({ length: sells ? 6 : 2 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : sells ? (
          <>
            <MetricCard label="Sales" value={data.totals.sales_count} />
            <MetricCard label="Revenue" value={money(data.totals.revenue)} />
            <MetricCard label="Cost of Goods" value={money(data.totals.cogs)} />
            <MetricCard label="Gross Profit" value={money(data.totals.gross_profit)} />
            <MetricCard label="Expenses" value={money(data.totals.expenses)} />
            <MetricCard label="Net Profit" value={money(data.totals.net_profit)} />
          </>
        ) : (
          <>
            <MetricCard label="Expenses" value={money(data.totals.expenses)} />
            <MetricCard label="Net" value={money(data.totals.net_profit)} />
          </>
        )}
      </div>

      {/* Revenue vs Expenses chart */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">
          {sells ? "Revenue vs Expenses" : "Expenses over time"}
        </h3>
        {report.isLoading ? (
          <div className="h-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        ) : (
          <Chart options={chartOptions} series={chartSeries} type="area" height={280} />
        )}
      </div>

      <div className={`grid grid-cols-1 gap-6 ${sells ? "lg:grid-cols-2" : ""}`}>
        {/* Top products — a business that sells nothing has no top seller, and
            "No sales in this period" every month is not information. */}
        {sells && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Top Items</h3>
          {report.isLoading ? (
            <div className="h-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          ) : (data?.top_products ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No sales in this period.
            </p>
          ) : (
            <table className="w-full text-left text-theme-sm">
              <thead>
                <tr className="text-theme-xs text-gray-500 dark:text-gray-400">
                  <th className="pb-2 font-medium">Item</th>
                  <th className="pb-2 text-right font-medium">Units</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {(data?.top_products ?? []).map((p) => (
                  <tr key={p.name} className="text-gray-700 dark:text-gray-300">
                    <td className="py-2.5">{p.name}</td>
                    <td className="py-2.5 text-right">{p.units}</td>
                    <td className="py-2.5 text-right font-medium">{money(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        )}

        {/* Expenses by category */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">
            Expenses by Category
          </h3>
          {report.isLoading ? (
            <div className="h-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          ) : (data?.expenses_by_category ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No expenses in this period.
            </p>
          ) : (
            <div className="space-y-3">
              {(data?.expenses_by_category ?? []).map((row) => {
                const max = data?.expenses_by_category[0]?.total || 1;
                return (
                  <div key={row.category}>
                    <div className="mb-1 flex justify-between text-theme-sm text-gray-700 dark:text-gray-300">
                      <span>{row.category}</span>
                      <span className="font-medium">{money(row.total)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className="h-2 rounded-full bg-brand-500"
                        style={{ width: `${Math.max(4, (row.total / max) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </>
      )}
    </>
  );
}

const fmt = (n: number) => `Rs ${Number(n).toLocaleString()}`;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">{title}</h3>
      {children}
    </div>
  );
}

function PurchasesTab({ period }: { period: string }) {
  const q = usePurchasesReport(period, true);
  const d = q.data;
  if (q.isLoading || !d) return <div className="h-40 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Purchase orders" value={d.totals.orders} />
        <MetricCard label="Ordered value" value={fmt(d.totals.ordered_value)} />
        <MetricCard label="Paid" value={fmt(d.totals.paid)} />
        <MetricCard label="Outstanding" value={fmt(d.totals.outstanding)} />
      </div>
      <Panel title="By supplier">
        {d.by_supplier.length === 0 ? <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No purchases in this period.</p> : (
          <table className="w-full text-left text-theme-sm">
            <thead><tr className="text-theme-xs text-gray-500 dark:text-gray-400"><th className="pb-2 font-medium">Supplier</th><th className="pb-2 text-right font-medium">Orders</th><th className="pb-2 text-right font-medium">Total</th><th className="pb-2 text-right font-medium">Outstanding</th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {d.by_supplier.map((r) => (
                <tr key={r.supplier} className="text-gray-700 dark:text-gray-300">
                  <td className="py-2.5">{r.supplier}</td><td className="py-2.5 text-right">{r.orders}</td>
                  <td className="py-2.5 text-right font-medium">{fmt(r.total)}</td>
                  <td className="py-2.5 text-right text-error-500">{fmt(r.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

function StaffTab({ period }: { period: string }) {
  const q = useStaffReport(period, true);
  const d = q.data;
  if (q.isLoading || !d) return <div className="h-40 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  return (
    <Panel title="Staff performance">
      {d.staff.length === 0 ? <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No sales in this period.</p> : (
        <table className="w-full text-left text-theme-sm">
          <thead><tr className="text-theme-xs text-gray-500 dark:text-gray-400"><th className="pb-2 font-medium">Staff</th><th className="pb-2 text-right font-medium">Sales</th><th className="pb-2 text-right font-medium">Revenue</th></tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {d.staff.map((s) => (
              <tr key={s.staff_id} className="text-gray-700 dark:text-gray-300">
                <td className="py-2.5">{s.name}</td><td className="py-2.5 text-right">{s.sales_count}</td>
                <td className="py-2.5 text-right font-medium">{fmt(s.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function TaxTab({ period }: { period: string }) {
  const q = useTaxReport(period, true);
  const d = q.data;
  if (q.isLoading || !d) return <div className="h-40 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <MetricCard label="Taxable sales" value={d.totals.taxable_sales} />
      <MetricCard label="Net sales" value={fmt(d.totals.net_sales)} />
      <MetricCard label="Tax collected" value={fmt(d.totals.tax_collected)} />
      <MetricCard label="Gross sales" value={fmt(d.totals.gross_sales)} />
    </div>
  );
}
