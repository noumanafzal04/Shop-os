import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { PieChartIcon } from "../../../../icons";
import type { AdminDashboard } from "../../types";
import { useChartTokens } from "./chartTokens";
import { Panel, PanelEmpty, Pulse } from "./Panel";
import { count } from "./format";

const HEIGHT = 260;

/**
 * The palette carries five distinct slots; a sixth hue would be a generated
 * colour nobody validated, so the tail folds into one honest "Other" slice that
 * still sums to the real total.
 */
const MAX_SLICES = 5;

interface Props {
  types?: AdminDashboard["business_types"];
  loading?: boolean;
}

export function BusinessTypesPanel({ types, loading = false }: Props) {
  const t = useChartTokens();
  const rows = types ?? [];
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  const head = rows.slice(0, MAX_SLICES);
  const tail = rows.slice(MAX_SLICES);
  const slices = tail.length
    ? [
        ...head.map((r, i) => ({ label: r.label, count: r.count, color: t.categorical[i] })),
        {
          label: `Other (${tail.length} types)`,
          count: tail.reduce((sum, r) => sum + r.count, 0),
          color: t.neutral,
        },
      ]
    : head.map((r, i) => ({ label: r.label, count: r.count, color: t.categorical[i] }));

  const options: ApexOptions = {
    colors: slices.map((s) => s.color),
    labels: slices.map((s) => s.label),
    chart: { type: "donut", height: HEIGHT, fontFamily: t.fontFamily },
    // Slices are separated by the surface itself rather than by an outline.
    stroke: { colors: [t.surface], width: 2 },
    dataLabels: { enabled: false },
    legend: { show: false },
    plotOptions: {
      pie: {
        donut: {
          size: "68%",
          labels: {
            show: true,
            name: { show: true, fontSize: "12px", color: t.muted, offsetY: 18 },
            value: {
              show: true,
              fontSize: "24px",
              fontWeight: 700,
              color: t.ink,
              offsetY: -14,
              formatter: (v: string) => count(Number(v)),
            },
            total: {
              show: true,
              label: "Tenants",
              fontSize: "12px",
              color: t.muted,
              formatter: () => count(total),
            },
          },
        },
      },
    },
    tooltip: { theme: t.tooltip, y: { formatter: (v: number) => `${count(v)} tenants` } },
    states: { hover: { filter: { type: "none" } } },
  };

  return (
    <Panel
      className="h-full"
      title="Business Types"
      subtitle="How the platform's tenants split"
      icon={<PieChartIcon className="size-5" />}
    >
      {loading || !types ? (
        <div className="flex flex-col items-center gap-4">
          <Pulse className="h-[200px] w-[200px] rounded-full" />
          <div className="flex w-full flex-wrap gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Pulse key={i} className="h-3 w-24" />
            ))}
          </div>
        </div>
      ) : total === 0 ? (
        <PanelEmpty>No tenants on the platform yet.</PanelEmpty>
      ) : (
        <>
          <Chart
            options={options}
            series={slices.map((s) => s.count)}
            type="donut"
            height={HEIGHT}
          />

          {/* A ruled list, not a wrapped dot cloud: identity is never colour
              alone, and a share column is the sentence an operator says out
              loud ("mart is 40% of the book"). */}
          <ul className="mt-4 space-y-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            {slices.map((s) => (
              <li key={s.label} className="flex min-w-0 items-center gap-2 text-theme-xs">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="truncate text-gray-700 dark:text-gray-300">{s.label}</span>
                <span className="ml-auto shrink-0 font-medium tabular-nums text-gray-800 dark:text-white/90">
                  {count(s.count)}
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-gray-500 dark:text-gray-400">
                  {Math.round((s.count / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
