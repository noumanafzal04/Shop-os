import { useMemo, useState } from "react";
import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";
import { useMoney } from "../../shop/hooks/useShop";
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import PageMeta from "../../../components/common/PageMeta";
import Alert from "../../../components/ui/alert/Alert";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { MetricCard, MetricCardSkeleton } from "../../../common/ui/MetricCard";
import { usePurchasesReport, useReport, useStaffReport, useTaxReport } from "../hooks/useExpenses";
import { ReprintReportTab } from "../../receipts/components/ReprintReportTab";
import { OfflineReportTab } from "../../offline/report/OfflineReportTab";
import { DeadStockTab, MarginsTab, ValuationTab } from "../components/StockReportTabs";
import { useAuthStore } from "../../../stores/authStore";
import { reportTabs, shopSells, SALES_TABS, STOCK_TABS } from "../reportTabs";
import { PERIODS, rangeError, resolveReportRange, type PeriodKey, type ReportRange } from "../reportPeriod";

export default function ReportsPage() {
  const money = useMoney();
  const features = useAuthStore((s) => s.user?.tenant?.features);
  const tracksStock = !!features?.inventory;
  // A books-only business (Finance Manager) sells nothing and stocks nothing.
  // Which tabs that leaves is decided in reportTabs, where it can be tested.
  const sells = shopSells(features);
  const [period, setPeriod] = useState<PeriodKey>("monthly");
  // Only meaningful while `period` is custom, but kept across a switch away
  // and back so a merchant comparing "this month" against the fortnight they
  // typed does not have to type it twice.
  const [custom, setCustom] = useState(() => {
    const seed = resolveReportRange("custom");

    return { from: seed.from, to: seed.to };
  });
  const [selectedTab, setTab] = useState<string>("overview");
  // A shop can lose a module while someone is sitting on the tab it fed.
  // Falling back beats rendering a tab whose every request now 403s.
  const unavailable = (STOCK_TABS.includes(selectedTab) && !tracksStock)
    || (SALES_TABS.includes(selectedTab) && !sells);
  const tab = unavailable ? "overview" : selectedTab;

  const range = useMemo(
    () => resolveReportRange(period, custom.from, custom.to),
    [period, custom.from, custom.to],
  );
  // Refused here in the server's own words rather than after a round trip,
  // and — the part that matters — the half-typed range is never SENT, so the
  // figures on screen never briefly answer a question nobody asked.
  const invalid = rangeError(range);
  const asked: ReportRange = invalid ? resolveReportRange("monthly") : range;

  const report = useReport(asked);

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
  // it is a line the reader has to work out is meaningless. A books-only
  // business has a real line to draw there — it just isn't sales, so it plots
  // what it actually took in instead.
  const chartSeries = [
    ...(sells
      ? [{ name: "Revenue", data: (data?.series ?? []).map((b) => b.revenue) }]
      : [{ name: "Money in", data: (data?.series ?? []).map((b) => b.other_income) }]),
    { name: "Expenses", data: (data?.series ?? []).map((b) => b.expenses) },
  ];

  return (
    <>
      <PageMeta title="Reports | ShopOS" description="Business performance" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Reports</h2>
          {/* The window this screen is showing, resolved locally so it is
              right before the first response lands rather than a request
              behind the buttons above it. */}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {invalid ? "Choose a range" : `${asked.from} → ${asked.to}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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

      {/* A month is an accident of the calendar. A shop closing its books
          against 1–15, a quarter, or the stretch since the last audit needs
          to say so — the server has validated exactly this since these
          reports were written and nothing ever asked for it. */}
      {period === "custom" && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:max-w-lg">
            <div>
              <Label>From</Label>
              <Input
                type="date"
                value={custom.from}
                max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
            </div>
            <div>
              <Label>To</Label>
              <Input
                type="date"
                value={custom.to}
                min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </div>
          </div>
          {invalid && <p className="mt-2 text-theme-xs text-error-500">{invalid}</p>}
        </div>
      )}

      <FilterTabs
        tabs={TABS.map(([key, label]) => ({ key, label }))}
        value={tab}
        onChange={setTab}
        className="mb-6"
      />

      {report.isError && (
        <div className="mb-6">
          <Alert variant="error" title="Couldn't load report" message="Check your connection and try again." />
        </div>
      )}

      {/* Every tab gets the SAME window object. They used to be handed a bare
          period name, so any tab that resolved its own dates could — and one
          did — report a different week than the header claimed. */}
      {tab === "margins" ? <MarginsTab range={asked} /> : tab === "valuation" ? <ValuationTab /> : tab === "dead-stock" ? <DeadStockTab /> : tab === "purchases" ? <PurchasesTab range={asked} /> : tab === "staff" ? <StaffTab range={asked} /> : tab === "tax" ? <TaxTab range={asked} /> : tab === "receipts" ? <ReprintReportTab range={asked} /> : tab === "offline" ? <OfflineReportTab /> : (
      <>
      {/* Totals. A shop that sells nothing is shown what it actually has —
          money in, money out, and what that leaves — not four cards of Rs 0
          padding out a row. `Money in` is not optional here: without it this
          screen printed Net as minus the whole of what the business spent,
          while the Cashbook one click away had it right. */}
      <div
        className={`mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6 ${
          sells ? "xl:grid-cols-6" : "sm:grid-cols-3"
        }`}
      >
        {report.isLoading || !data ? (
          Array.from({ length: sells ? 6 : 3 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : sells ? (
          <>
            <MetricCard label="Sales" value={data.totals.sales_count} />
            <MetricCard label="Revenue" value={money(data.totals.revenue)} />
            {/* Only when there IS some. Most shops record no non-sale income,
                and a permanent Rs 0 card is the padding this row was cleaned
                of in the first place. */}
            {data.totals.other_income > 0 && (
              <MetricCard label="Other Income" value={money(data.totals.other_income)} />
            )}
            <MetricCard label="Cost of Goods" value={money(data.totals.cogs)} />
            <MetricCard label="Gross Profit" value={money(data.totals.gross_profit)} />
            <MetricCard label="Expenses" value={money(data.totals.expenses)} />
            <MetricCard label="Net Profit" value={money(data.totals.net_profit)} />
          </>
        ) : (
          <>
            <MetricCard label="Money In" value={money(data.totals.other_income)} />
            <MetricCard label="Money Out" value={money(data.totals.expenses)} />
            <MetricCard label="Net" value={money(data.totals.net_profit)} />
          </>
        )}
      </div>

      {/* Revenue vs Expenses chart */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">
          {sells ? "Revenue vs Expenses" : "Money in vs money out"}
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

function PurchasesTab({ range }: { range: ReportRange }) {
  const q = usePurchasesReport(range, true);
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

function StaffTab({ range }: { range: ReportRange }) {
  const q = useStaffReport(range, true);
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

function TaxTab({ range }: { range: ReportRange }) {
  const q = useTaxReport(range, true);
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
