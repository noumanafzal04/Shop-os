import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

import { useTheme } from "../../../../context/ThemeContext";
import type { ExpenseSlice } from "../../types";
import { useChartColors } from "./chartTheme";
import { EmptyPanel } from "./SectionCard";

/** Slices past this are rolled into one "Other" wedge so the donut stays readable. */
const MAX_SLICES = 6;

interface Props {
  breakdown: ExpenseSlice[];
  money: (n: string | number) => string;
}

/**
 * This month's spend per category. The wedges walk down the tenant's own brand
 * ramp — a sequential palette, since expense categories have no inherent
 * good/bad meaning that a red or green wedge would imply.
 */
export function ExpenseDonut({ breakdown, money }: Props) {
  const colors = useChartColors();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const ramp = [
    colors["brand-600"],
    colors["brand-400"],
    colors["brand-800"],
    colors["brand-300"],
    colors["brand-700"],
    colors["brand-200"],
    colors["gray-300"],
  ];

  const head = breakdown.slice(0, MAX_SLICES);
  const tail = breakdown.slice(MAX_SLICES);
  const slices = tail.length
    ? [...head, { category: `Other (${tail.length})`, total: tail.reduce((s, x) => s + x.total, 0) }]
    : head;

  const total = breakdown.reduce((sum, slice) => sum + slice.total, 0);

  const options: ApexOptions = {
    chart: { type: "donut", fontFamily: "Outfit, sans-serif", animations: { enabled: false } },
    labels: slices.map((s) => s.category),
    colors: ramp.slice(0, slices.length),
    legend: { show: false },
    dataLabels: { enabled: false },
    stroke: { width: 0 },
    plotOptions: {
      pie: {
        donut: {
          size: "72%",
          // Idle centre = this month's total; hovering a wedge swaps in that
          // category's own name and figure.
          labels: {
            show: true,
            name: {
              show: true,
              fontSize: "12px",
              color: dark ? colors["gray-400"] : colors["gray-500"],
            },
            value: {
              show: true,
              fontSize: "22px",
              fontWeight: "700",
              color: dark ? "#ffffff" : colors["gray-800"],
              formatter: (value: string) => money(value),
            },
            total: {
              show: true,
              showAlways: true,
              label: "This month",
              fontSize: "12px",
              color: dark ? colors["gray-400"] : colors["gray-500"],
              formatter: () => money(total),
            },
          },
        },
      },
    },
    tooltip: {
      theme: dark ? "dark" : "light",
      y: { formatter: (value: number) => money(value) },
    },
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-gray-700 sm:p-6">
      <h3 className="font-semibold tracking-tight text-gray-800 dark:text-white/90">
        Where the money went
      </h3>
      <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
        Expenses this month, by category
      </p>

      {slices.length === 0 ? (
        <div className="mt-5">
          <EmptyPanel
            message="No expenses recorded this month."
            hint="Categories appear here as soon as you log one."
          />
        </div>
      ) : (
        <>
          <div className="mt-2">
            <Chart options={options} series={slices.map((s) => s.total)} type="donut" height={240} />
          </div>
          {/* A share column beside the rupees: "Rent, 60%" is the sentence a
              shopkeeper actually says, and the donut alone cannot be measured
              by eye past two or three wedges. */}
          <ul className="mt-4 space-y-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            {slices.map((slice, i) => (
              <li key={slice.category} className="flex min-w-0 items-center gap-2 text-theme-xs">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ramp[i % ramp.length] }}
                />
                <span className="truncate text-gray-700 dark:text-gray-300">{slice.category}</span>
                <span className="ml-auto shrink-0 tabular-nums font-medium text-gray-800 dark:text-white/90">
                  {money(slice.total)}
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-gray-500 dark:text-gray-400">
                  {total > 0 ? `${Math.round((slice.total / total) * 100)}%` : "—"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
