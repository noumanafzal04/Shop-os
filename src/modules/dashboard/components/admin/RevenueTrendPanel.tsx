import { useState } from "react";
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import type { AdminDashboard } from "../../types";
import { useChartTokens } from "./chartTokens";
import { ChartPulse, Panel, PanelEmpty } from "./Panel";
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

  const options: ApexOptions = {
    colors: [t.line],
    chart: {
      type: "area",
      height: HEIGHT,
      fontFamily: t.fontFamily,
      toolbar: { show: false },
      animations: { enabled: false },
    },
    stroke: { curve: "smooth", width: 2 },
    fill: { type: "gradient", gradient: { opacityFrom: 0.35, opacityTo: 0 } },
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
    },
    yaxis: {
      labels: { style: { colors: t.axis, fontSize: "12px" }, formatter: (v: number) => compact(v) },
    },
    legend: { show: false },
    tooltip: {
      theme: t.tooltip,
      y: { formatter: (v: number) => money(v) },
    },
  };

  return (
    <Panel
      title="Subscription Revenue"
      subtitle={
        loading || !series
          ? undefined
          : `${money(windowTotal)} collected over the last ${window.length} months`
      }
      aside={
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              type="button"
              onClick={() => setMonths(w.months)}
              className={`rounded-md px-3 py-1.5 text-theme-xs font-medium transition ${
                months === w.months
                  ? "bg-white text-gray-800 shadow-theme-xs dark:bg-white/10 dark:text-white/90"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white/90"
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
      )}
    </Panel>
  );
}
