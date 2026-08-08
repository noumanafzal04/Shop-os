import { useState } from "react";
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

import { PieChartIcon } from "../../../../icons";
import type { AdminDashboard } from "../../types";
import { useChartTokens } from "./chartTokens";
import { ChartPulse, Panel, PanelEmpty, PanelStat } from "./Panel";
import { compact, money } from "./format";

/**
 * The payload carries subscription revenue per calendar month and nothing
 * finer, so the toggle narrows the window over real months — it never invents a
 * daily or hourly breakdown the API cannot supply.
 */
const WINDOWS = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "12M", months: 12 },
] as const;

const HEIGHT = 300;

interface Props {
  series?: AdminDashboard["revenue_series"];
  loading?: boolean;
}

export function RevenueTrendPanel({ series, loading = false }: Props) {
  const [months, setMonths] = useState<number>(12);
  const t = useChartTokens();

  const window = (series ?? []).slice(-months);
  const windowTotal = window.reduce((sum, m) => sum + m.total, 0);
  const hasMoney = (series ?? []).some((m) => m.total > 0);

  // The best month in the window, and the average across it. Both are sums of
  // the months the payload sent — no month exists here that the API didn't.
  const best = window.reduce<AdminDashboard["revenue_series"][number] | null>(
    (top, m) => (top === null || m.total > top.total ? m : top),
    null,
  );
  const average = window.length > 0 ? windowTotal / window.length : 0;

  const options: ApexOptions = {
    colors: [t.line],
    chart: {
      type: "area",
      height: HEIGHT,
      fontFamily: t.fontFamily,
      toolbar: { show: false },
      animations: { enabled: false },
    },
    stroke: { curve: "smooth", width: 2.5 },
    fill: {
      type: "gradient",
      gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0, stops: [0, 92, 100] },
    },
    dataLabels: { enabled: false },
    markers: { size: 0, strokeColors: t.surface, strokeWidth: 2, hover: { size: 6 } },
    grid: {
      borderColor: t.grid,
      strokeDashArray: 3,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { left: 8, right: 8 },
    },
    xaxis: {
      type: "category",
      categories: window.map((m) => m.month),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: t.axis, fontSize: "12px" } },
      tooltip: { enabled: false },
      crosshairs: { stroke: { color: t.grid, dashArray: 4 } },
    },
    yaxis: {
      labels: { style: { colors: t.axis, fontSize: "12px" }, formatter: (v: number) => compact(v) },
    },
    legend: { show: false },
    // The mean is the line the reader is really comparing each month against;
    // drawing it saves them doing it by eye.
    annotations:
      average > 0
        ? {
            yaxis: [
              {
                y: average,
                borderColor: t.muted,
                strokeDashArray: 4,
                label: {
                  text: `avg ${money(Math.round(average))}`,
                  position: "left",
                  textAnchor: "start",
                  offsetX: 8,
                  style: { background: "transparent", color: t.muted, fontSize: "11px" },
                  borderWidth: 0,
                },
              },
            ],
          }
        : {},
    tooltip: {
      theme: t.tooltip,
      y: { formatter: (v: number) => money(v) },
    },
  };

  return (
    <Panel
      className="h-full"
      title="Subscription Revenue"
      subtitle="What the platform billed, month by month"
      icon={<PieChartIcon className="size-5" />}
      aside={
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              type="button"
              onClick={() => setMonths(w.months)}
              aria-pressed={months === w.months}
              className={`rounded-md px-3 py-1.5 text-theme-xs font-medium transition-colors ${
                months === w.months
                  ? "bg-white text-gray-800 shadow-theme-xs dark:bg-white/10 dark:text-white/90"
                  : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white/90"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      }
    >
      {loading || !series ? (
        <ChartPulse height={HEIGHT} />
      ) : !hasMoney ? (
        <PanelEmpty>No subscription payments recorded yet.</PanelEmpty>
      ) : (
        <>
          <PanelStat
            value={money(windowTotal)}
            caption={`collected over the last ${window.length} ${
              window.length === 1 ? "month" : "months"
            }`}
            aside={
              best && best.total > 0 ? (
                <span className="rounded-lg bg-success-50 px-2.5 py-1.5 text-theme-xs font-medium text-success-700 ring-1 ring-success-100 dark:bg-success-500/15 dark:text-success-500 dark:ring-success-500/25">
                  Best month · {best.month} · {money(best.total)}
                </span>
              ) : undefined
            }
          />
          <div className="max-w-full overflow-x-auto custom-scrollbar">
            <div className="min-w-[560px]">
              <Chart
                options={options}
                series={[{ name: "Revenue", data: window.map((m) => m.total) }]}
                type="area"
                height={HEIGHT}
              />
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
