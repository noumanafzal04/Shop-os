import { useState } from "react";
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

import { useTheme } from "../../../../context/ThemeContext";
import type { SeriesDay } from "../../types";
import { useChartColors } from "./chartTheme";
import { EmptyPanel, SkeletonBar } from "./SectionCard";
import { formatDate } from "./format";

/**
 * The payload carries exactly seven days, so the toggle offers the windows
 * those days can honestly answer for. There is no month or year series in the
 * contract, and a chart must never draw a period it wasn't given.
 */
const WINDOWS = [
  { key: "today", label: "Today", days: 1 },
  { key: "three", label: "3 Days", days: 3 },
  { key: "week", label: "Week", days: 7 },
] as const;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

interface Props {
  series: SeriesDay[];
  money: (n: string | number) => string;
  showRevenue: boolean;
  showExpenses: boolean;
  showProfit: boolean;
}

export function SalesTrendChart({ series, money, showRevenue, showExpenses, showProfit }: Props) {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]["key"]>("week");
  const colors = useChartColors();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const days = series.slice(-(WINDOWS.find((w) => w.key === window)?.days ?? 7));

  const chartSeries = [
    showRevenue && { name: "Revenue", data: days.map((d) => d.revenue), color: colors["brand-500"] },
    showExpenses && { name: "Expenses", data: days.map((d) => d.expenses), color: colors["warning-500"] },
    showProfit && { name: "Profit", data: days.map((d) => d.profit), color: colors["success-500"] },
  ].filter((s): s is { name: string; data: number[]; color: string } => Boolean(s));

  const allZero = chartSeries.every((s) => s.data.every((v) => v === 0));
  // One data point is a dot on a line chart; bars read as a figure.
  const type = days.length === 1 ? "bar" : "line";

  const options: ApexOptions = {
    chart: {
      type,
      height: 310,
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      animations: { enabled: false },
    },
    colors: chartSeries.map((s) => s.color),
    stroke: { curve: "smooth", width: type === "line" ? 2 : 0 },
    plotOptions: { bar: { columnWidth: "35%", borderRadius: 4, borderRadiusApplication: "end" } },
    markers: { size: 0, hover: { size: 5 } },
    dataLabels: { enabled: false },
    legend: { show: false },
    grid: {
      borderColor: dark ? colors["gray-800"] : colors["gray-100"],
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { left: 8, right: 8 },
    },
    xaxis: {
      type: "category",
      categories: days.map((d) => d.day),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: dark ? colors["gray-400"] : colors["gray-500"], fontSize: "12px" } },
      tooltip: { enabled: false },
    },
    yaxis: {
      labels: {
        style: { colors: dark ? colors["gray-400"] : colors["gray-500"], fontSize: "12px" },
        formatter: (value: number) => compact.format(value),
      },
    },
    tooltip: {
      theme: dark ? "dark" : "light",
      y: { formatter: (value: number) => money(value) },
    },
  };

  const first = days[0];
  const last = days[days.length - 1];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">
            {showRevenue ? "Sales & Spending" : "Spending"}
          </h3>
          <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
            {first && last
              ? days.length === 1
                ? formatDate(last.date)
                : `${formatDate(first.date)} → ${formatDate(last.date)}`
              : "No data yet"}
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindow(w.key)}
              className={`rounded-md px-3 py-1.5 text-theme-xs font-medium transition-colors ${
                window === w.key
                  ? "bg-white text-gray-800 shadow-theme-xs dark:bg-gray-900 dark:text-white/90"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {chartSeries.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          {chartSeries.map((s) => (
            <span
              key={s.name}
              className="flex items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400"
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
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
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="flex items-center justify-between">
        <SkeletonBar className="h-4 w-32" />
        <SkeletonBar className="h-8 w-40 rounded-lg" />
      </div>
      <SkeletonBar className={`mt-6 w-full rounded-xl ${height}`} />
    </section>
  );
}
