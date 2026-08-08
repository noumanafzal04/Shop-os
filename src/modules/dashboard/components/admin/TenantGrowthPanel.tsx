import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

import { GroupIcon } from "../../../../icons";
import type { AdminDashboard } from "../../types";
import { useChartTokens } from "./chartTokens";
import { ChartPulse, LegendChip, Panel, PanelEmpty, PanelStat } from "./Panel";
import { count } from "./format";

const HEIGHT = 260;

interface Props {
  growth?: AdminDashboard["tenant_growth"];
  loading?: boolean;
}

/**
 * Sign-ups per month, split by where those tenants stand today — so a tall bar
 * with a red cap says the month recruited badly, not that churn happened then.
 */
export function TenantGrowthPanel({ growth, loading = false }: Props) {
  const t = useChartTokens();
  const rows = growth ?? [];
  const hasSignups = rows.some((m) => m.total > 0);

  const signups = rows.reduce((sum, m) => sum + m.total, 0);
  const active = rows.reduce((sum, m) => sum + m.active, 0);
  const suspended = rows.reduce((sum, m) => sum + m.suspended, 0);

  const options: ApexOptions = {
    colors: [t.active, t.suspended],
    chart: {
      type: "bar",
      height: HEIGHT,
      stacked: true,
      fontFamily: t.fontFamily,
      toolbar: { show: false },
      animations: { enabled: false },
    },
    plotOptions: {
      bar: {
        columnWidth: "45%",
        borderRadius: 5,
        borderRadiusApplication: "end",
        borderRadiusWhenStacked: "last",
      },
    },
    // A surface-coloured edge is the 2px gap between stacked segments.
    stroke: { show: true, width: 2, colors: [t.surface] },
    dataLabels: { enabled: false },
    grid: {
      borderColor: t.grid,
      strokeDashArray: 3,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { left: 8, right: 8 },
    },
    xaxis: {
      categories: rows.map((m) => m.month),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: t.axis, fontSize: "12px" } },
    },
    yaxis: {
      labels: {
        style: { colors: t.axis, fontSize: "12px" },
        formatter: (v: number) => String(Math.round(v)),
      },
    },
    // The key is drawn as chips below, where each series can carry its own
    // total; apex's built-in legend can only name a colour.
    legend: { show: false },
    fill: { opacity: 1 },
    tooltip: { theme: t.tooltip, y: { formatter: (v: number) => `${v} tenants` } },
  };

  return (
    <Panel
      className="h-full"
      title="Tenant Growth"
      subtitle="Sign-ups per month, by status today"
      icon={<GroupIcon className="size-5" />}
    >
      {loading || !growth ? (
        <ChartPulse height={HEIGHT} />
      ) : !hasSignups ? (
        <PanelEmpty>No sign-ups in the last six months.</PanelEmpty>
      ) : (
        <>
          <PanelStat
            value={count(signups)}
            caption={`signed up over the last ${rows.length} ${
              rows.length === 1 ? "month" : "months"
            }`}
          />
          <div className="mb-4 flex flex-wrap gap-2">
            <LegendChip
              color={t.active}
              label="Active"
              value={count(active)}
              title="Of those sign-ups, still trading today"
            />
            <LegendChip
              color={t.suspended}
              label="Suspended"
              value={count(suspended)}
              title="Of those sign-ups, suspended today"
            />
          </div>
          <div className="max-w-full overflow-x-auto custom-scrollbar">
            <div className="min-w-[360px]">
              <Chart
                options={options}
                series={[
                  { name: "Active", data: rows.map((m) => m.active) },
                  { name: "Suspended", data: rows.map((m) => m.suspended) },
                ]}
                type="bar"
                height={HEIGHT}
              />
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
