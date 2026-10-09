import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

import { useTheme } from "../../../../context/ThemeContext";
import { formatRange, fromIsoDate } from "../../../../components/ui/filters";
import { seriesGrain, type PeriodTold } from "../../period";
import type { SeriesDay } from "../../types";
import { useChartColors } from "./chartTheme";
import { EmptyPanel, SkeletonBar } from "./SectionCard";
import { formatDate } from "./format";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** As many names as the axis has room for before they run into each other. */
const MOST_AXIS_LABELS = 10;

interface Props {
  series: SeriesDay[];
  /**
   * The period the page is reading. The chart draws what the SERVER cut for
   * it — a point a day, a week or a month — and says which; it used to carry
   * a Today / 3 Days / Week toggle of its own, which is one window too many
   * on a page that now has a period at the top of it.
   */
  period: PeriodTold;
  money: (n: string | number) => string;
  showRevenue: boolean;
  showExpenses: boolean;
  showProfit: boolean;
}

/** What one point covers, written out — the tooltip's heading. */
function pointTitle(point: SeriesDay, today: Date): string {
  return point.to && point.to !== point.date
    ? formatRange({ from: point.date, to: point.to }, today)
    : formatDate(point.date);
}

export function SalesTrendChart({ series, period, money, showRevenue, showExpenses, showProfit }: Props) {
  const colors = useChartColors();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const days = series;
  const asOf = fromIsoDate(period.today);
  // Thirty names on an axis is thirty names nobody can read. Every nth one
  // is kept; the tooltip still names every point in full.
  const every = Math.ceil(days.length / MOST_AXIS_LABELS);

  const chartSeries = [
    showRevenue && { name: "Revenue", data: days.map((d) => d.revenue), color: colors["brand-500"] },
    showExpenses && { name: "Expenses", data: days.map((d) => d.expenses), color: colors["warning-500"] },
    showProfit && { name: "Profit", data: days.map((d) => d.profit), color: colors["success-500"] },
  ].filter((s): s is { name: string; data: number[]; color: string } => Boolean(s));

  const allZero = chartSeries.every((s) => s.data.every((v) => v === 0));
  // One data point is a dot on a line chart; bars read as a figure.
  const type = days.length === 1 ? "bar" : "area";

  const options: ApexOptions = {
    chart: {
      type,
      height: 310,
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      animations: { enabled: false },
    },
    colors: chartSeries.map((s) => s.color),
    stroke: { curve: "smooth", lineCap: "round", width: type === "area" ? 3 : 0 },
    // A washed fill under each line reads as volume rather than a wire diagram;
    // it fades to nothing so three overlapping series never turn to mud.
    fill:
      type === "area"
        ? {
            type: "gradient",
            gradient: {
              shadeIntensity: 1,
              opacityFrom: dark ? 0.3 : 0.28,
              opacityTo: 0,
              stops: [0, 92, 100],
            },
          }
        : { type: "solid", opacity: 1 },
    plotOptions: { bar: { columnWidth: "35%", borderRadius: 4, borderRadiusApplication: "end" } },
    markers: { size: 0, strokeWidth: 3, strokeColors: dark ? colors["gray-800"] : "#fff", hover: { size: 6 } },
    dataLabels: { enabled: false },
    legend: { show: false },
    grid: {
      borderColor: dark ? colors["gray-800"] : colors["gray-100"],
      strokeDashArray: 3,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { left: 8, right: 18 },
    },
    xaxis: {
      type: "category",
      categories: days.map((d, i) => (i % every === 0 ? d.day : "")),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: dark ? colors["gray-400"] : colors["gray-500"], fontSize: "12px" } },
      tooltip: { enabled: false },
      crosshairs: { stroke: { color: dark ? colors["gray-500"] : colors["gray-300"], dashArray: 4 } },
    },
    yaxis: {
      labels: {
        style: { colors: dark ? colors["gray-400"] : colors["gray-500"], fontSize: "12px" },
        formatter: (value: number) => compact.format(value),
      },
    },
    tooltip: {
      theme: dark ? "dark" : "light",
      shared: true,
      intersect: false,
      x: {
        formatter: (_value: unknown, at?: { dataPointIndex?: number }) => {
          const point = days[at?.dataPointIndex ?? -1];

          return point ? pointTitle(point, asOf) : "";
        },
      },
      y: { formatter: (value: number) => money(value) },
    },
  };

  const first = days[0];
  const last = days[days.length - 1];

  return (
    <section className="rounded-3xl border border-gray-200 bg-white px-5 pb-5 pt-5 shadow-theme-xs transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-gray-700 sm:px-6 sm:pt-6">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold tracking-tight text-gray-800 dark:text-white/90">
            {showRevenue ? "Sales & Spending" : "Spending"}
          </h3>
          <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400" data-testid="trend-window">
            {!first || !last
              ? "No data yet"
              : period.days === 1
                ? // One day is not a trend. It is drawn as the last of the
                  // seven that led to it, and the card says that is what it did.
                  `The seven days up to ${formatDate(last.date)}`
                : `${formatDate(first.date)} → ${formatDate(last.to ?? last.date)} · a point ${seriesGrain(period)}`}
          </p>
        </div>
      </div>

      {/* The legend carries each series' total for the window on screen, so the
          key earns its space instead of only naming colours. */}
      {chartSeries.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {chartSeries.map((s) => (
            <span
              key={s.name}
              title={`${s.name} — total for the selected period`}
              className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-theme-xs text-gray-600 ring-1 ring-gray-200 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-800"
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
              <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">
                {money(s.data.reduce((sum, v) => sum + v, 0))}
              </span>
            </span>
          ))}
        </div>
      )}

      {allZero ? (
        <EmptyPanel
          message={
            showRevenue
              ? "No sales or expenses recorded in this period."
              : "No expenses recorded in this period."
          }
          hint="Figures appear here the moment the first one is recorded."
        />
      ) : (
        <div className="custom-scrollbar max-w-full overflow-x-auto">
          <div className="min-w-[520px]">
            <Chart options={options} series={chartSeries} type={type} height={310} />
          </div>
        </div>
      )}
    </section>
  );
}

export function ChartSkeleton({ height = "h-[310px]" }: { height?: string }) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar className="h-3 w-40" />
        </div>
        <SkeletonBar className="h-8 w-40 rounded-lg" />
      </div>
      {/* The legend row is part of the loaded card's height; without it here the
          chart below shifts up the moment the payload lands. */}
      <div className="mt-5 flex gap-2">
        <SkeletonBar className="h-7 w-28 rounded-lg" />
        <SkeletonBar className="h-7 w-28 rounded-lg" />
      </div>
      <SkeletonBar className={`mt-4 w-full rounded-xl ${height}`} />
    </section>
  );
}
