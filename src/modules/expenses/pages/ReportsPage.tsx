import { useMemo, useRef, useState } from "react";
import { useFitsItsBox } from "../../../components/charts/useFitsItsBox";
import { DateRangeFilter, formatRange, type RangeKey } from "../../../components/ui/filters";
import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";
import { useMoney } from "../../shop/hooks/useShop";
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import PageMeta from "../../../components/common/PageMeta";
import Alert from "../../../components/ui/alert/Alert";
import { MetricCard, MetricCardSkeleton } from "../../../common/ui/MetricCard";
import { usePurchasesReport, useReport, useStaffReport, useTaxReport } from "../hooks/useExpenses";
import { ReprintReportTab } from "../../receipts/components/ReprintReportTab";
import { OfflineReportTab } from "../../offline/report/OfflineReportTab";
import { BankClaimsTab } from "../../banks/components/BankClaimsTab";
import { DeadStockTab, MarginsTab, ValuationTab } from "../components/StockReportTabs";
import { useAuthStore } from "../../../stores/authStore";
import { reportTabs, shopSells, SALES_TABS, STOCK_TABS } from "../reportTabs";
import { PERIODS, rangeError, resolveReportRange, type PeriodKey, type ReportRange } from "../reportPeriod";

/**
 * The rolling windows a report screen wants and the shop's own named periods
 * do not cover.
 *
 * `today`, `this_month`, `this_year` and `this_quarter` are left out because
 * PERIODS already names three of them and the fourth is close enough to read
 * as a duplicate — and a menu with two rows for one range cannot be trusted
 * about either.
 */
const REPORT_PRESETS: readonly RangeKey[] = ["yesterday", "last_7", "last_14", "last_30", "last_month"];

export default function ReportsPage() {
  const money = useMoney();
  // The box the chart must fit inside — watched, because the page can get
  // narrower without the window doing so. See useFitsItsBox.
  const chartBox = useRef<HTMLDivElement>(null);
  const chartWidth = useFitsItsBox(chartBox);
  const features = useAuthStore((s) => s.user?.tenant?.features);
  const tracksStock = !!features?.inventory;
  // A books-only business (Finance Manager) sells nothing and stocks nothing.
  // Which tabs that leaves is decided in reportTabs, where it can be tested.
  const sells = shopSells(features);
  /**
   * The window on screen, as two dates.
   *
   * It used to be a period NAME plus a stashed pair for custom, with a panel
   * of two bare date boxes appearing underneath when "Custom range" was
   * picked. Somebody closing their books against 1–15 had to know what month
   * it was and type both ends without a typo, and the header printed the
   * answer back at them as "2026-08-01 → 2026-08-26".
   *
   * One named control now, the same one every other list uses, carrying the
   * dates each name resolves to. The period NAMES still come from
   * reportPeriod — the tax year is 1 July to 30 June and no calendar preset
   * can express it — they are just handed to the control rather than drawn as
   * a second row of buttons.
   */
  const [range, setRange] = useState<{ from: string; to: string }>(() => {
    const seed = resolveReportRange("monthly");

    return { from: seed.from, to: seed.to };
  });
  const [selectedTab, setTab] = useState<string>("overview");
  // A shop can lose a module while someone is sitting on the tab it fed.
  // Falling back beats rendering a tab whose every request now 403s.
  const unavailable = (STOCK_TABS.includes(selectedTab) && !tracksStock)
    || (SALES_TABS.includes(selectedTab) && !sells);
  const tab = unavailable ? "overview" : selectedTab;

  /**
   * The shop's own named windows, resolved once, handed to the date control.
   *
   * "Custom range" is deliberately absent: the control has its own, and a row
   * that opens the same dialog twice under two names is a menu nobody trusts.
   */
  const namedPeriods = useMemo(
    () =>
      PERIODS.filter(([key]) => key !== "custom").map(([key, label]) => {
        const resolved = resolveReportRange(key);

        return { key, label, range: { from: resolved.from, to: resolved.to } };
      }),
    [],
  );

  // Whichever named window this pair of dates IS, so the request still carries
  // a period the server recognises — and "custom" when it is nobody's.
  const period: PeriodKey =
    (namedPeriods.find((p) => p.range.from === range.from && p.range.to === range.to)?.key as PeriodKey | undefined)
    ?? "custom";

  const asked: ReportRange = { period, from: range.from, to: range.to };
  // Refused in the server's own words rather than after a round trip. The
  // control cannot produce a backwards range — it orders the two ends itself —
  // so this now only fires on a half-open one.
  const invalid = rangeError(asked);

  // A half-open range is never SENT, so the figures on screen never briefly
  // answer a question nobody asked.
  const report = useReport(invalid ? resolveReportRange("monthly") : asked);

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
      <PageMeta title="Reports | CartZe" description="Business performance" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Reports</h2>
          {/* The window this screen is showing, resolved locally so it is
              right before the first response lands rather than a request
              behind the buttons above it. */}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {/* The window this screen is showing, in words rather than in two
                ISO dates the reader has to decode. */}
            {invalid ? "Choose a range" : formatRange({ from: asked.from, to: asked.to })}
          </p>
        </div>
        <DateRangeFilter
          label="This month"
          value={{ from: range.from, to: range.to }}
          onChange={(next) => setRange({ from: next.from ?? "", to: next.to ?? "" })}
          extra={namedPeriods}
          // The generic list minus the four the shop's own periods already
          // name. Offering "Today" twice, and "This Month" beside "This
          // month", is a menu with two rows for one range and two ticks for
          // one answer. What is left is what the report periods do NOT have:
          // rolling windows, and the month before this one.
          presets={REPORT_PRESETS}
          // A report is ALWAYS about a window. There is no "all time" here:
          // every figure on this screen is a sum over dates, and an unbounded
          // one is a query nobody meant to run.
          allowAll={false}
          align="right"
        />
      </div>

      {invalid && (
        <div className="mb-6">
          <Alert variant="warning" title="Choose a range" message={invalid} />
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
      {tab === "margins" ? <MarginsTab range={asked} /> : tab === "valuation" ? <ValuationTab /> : tab === "dead-stock" ? <DeadStockTab /> : tab === "purchases" ? <PurchasesTab range={asked} /> : tab === "staff" ? <StaffTab range={asked} /> : tab === "tax" ? <TaxTab range={asked} /> : tab === "receipts" ? <ReprintReportTab range={asked} /> : tab === "offline" ? <OfflineReportTab /> : tab === "bank-claims" ? <BankClaimsTab range={asked} /> : (
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
            {/* Next to the revenue it reduces, and only when the shop actually
                handed something back — same rule as Other Income below. Without
                it, Revenue − Cost of Goods does not equal Gross Profit and the
                row reads like an arithmetic error. */}
            {data.totals.refunds > 0 && (
              <MetricCard label="Refunds" value={money(data.totals.refunds)} />
            )}
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
        {/* `min-w-0` and a measured width, because ApexCharts writes an inline
            PIXEL width and only re-measures on window resize. See
            useFitsItsBox — a tablet held landscape had 1115px of canvas in a
            1080px window, and the whole page scrolled sideways for it. */}
        <div ref={chartBox} className="min-w-0">
          {report.isLoading ? (
            <div className="h-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          ) : (
            <Chart
              options={chartOptions}
              series={chartSeries}
              type="area"
              height={280}
              width={chartWidth}
            />
          )}
        </div>
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

/**
 * Who rang the sales, and — where the shop says so — who sold them.
 *
 * This screen used to show one table titled "Staff performance" over a figure
 * grouped by who OPERATED THE TILL. In a one-person shop those are the same
 * person. On a showroom floor they are not: the salesmen work the customers and
 * one cashier types, so the report credited the cashier with everybody's month
 * and named nobody who had done the work.
 *
 * So the till figure keeps its own heading, saying plainly what it counts, and
 * the seller figure sits above it when the shop tracks one — because that is
 * the question somebody opened this tab to ask.
 */
function StaffRows({ rows }: { rows: Array<{ staff_id: string; name: string; sales_count: number; revenue: number }> }) {
  return (
    <table className="w-full text-left text-theme-sm">
      <thead><tr className="text-theme-xs text-gray-500 dark:text-gray-400"><th className="pb-2 font-medium">Staff</th><th className="pb-2 text-right font-medium">Sales</th><th className="pb-2 text-right font-medium">Revenue</th></tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map((s) => (
          <tr key={s.staff_id} className="text-gray-700 dark:text-gray-300">
            <td className="py-2.5">{s.name}</td><td className="py-2.5 text-right">{s.sales_count}</td>
            <td className="py-2.5 text-right font-medium">{fmt(s.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StaffTab({ range }: { range: ReportRange }) {
  const q = useStaffReport(range, true);
  const d = q.data;
  if (q.isLoading || !d) return <div className="h-40 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;

  const empty = <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No sales in this period.</p>;

  return (
    <div className="space-y-5">
      {/* Absent, never empty: a shop that does not name a seller has no such
          table rather than a table of nobodies. */}
      {d.served.length > 0 && (
        <Panel title="Who sold it">
          <StaffRows rows={d.served} />
          {d.unattributed && (
            /* The honest half. These sales are NOT quietly credited to whoever
               was at the till — doing that is what made this report wrong. */
            <p className="mt-3 border-t border-gray-100 pt-3 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              {d.unattributed.sales_count} sale{d.unattributed.sales_count === 1 ? "" : "s"} ·{" "}
              {fmt(d.unattributed.revenue)} had nobody named. They are not counted above, and are
              not credited to whoever rang them.
            </p>
          )}
        </Panel>
      )}

      <Panel title={d.served.length > 0 ? "Who rang it up" : "Sales by till operator"}>
        {d.staff.length === 0 ? empty : <StaffRows rows={d.staff} />}
        {d.served.length === 0 && d.staff.length > 0 && (
          /* Says what it actually counts, which the old heading did not. */
          <p className="mt-3 border-t border-gray-100 pt-3 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            This counts who <em>entered</em> each sale. If your salesmen and your counter are
            different people, switch on “Ask who served the customer” in Settings → POS and this
            tab will also show who sold it.
          </p>
        )}
      </Panel>
    </div>
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
