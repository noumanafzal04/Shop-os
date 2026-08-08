import type { ReactNode } from "react";

import { ArrowDownIcon, ArrowUpIcon } from "../../../../icons";
import type { Kpi } from "../../types";
import { Sparkline } from "../Sparkline";
import { signedPct } from "./format";

interface Props {
  label: string;
  /** Already formatted — money and counts read differently. */
  value: string;
  icon: ReactNode;
  kpi: Kpi;
  /** What the comparison is against, e.g. "yesterday". Shown on hover. */
  basis: string;
  /** Same formatter as `value`, for the hover title. */
  format: (n: number) => string;
  /** The single tile the console leads with. */
  emphasis?: boolean;
  /**
   * The SAME quantity over time, when the payload happens to carry it — the
   * monthly revenue series behind "revenue this month", the monthly sign-up
   * series behind "new tenants this month". Never a series from a neighbouring
   * figure: a shape under a number is read as that number's history.
   */
  spark?: number[];
}

export function KpiTile({
  label,
  value,
  icon,
  kpi,
  basis,
  format,
  emphasis = false,
  spark,
}: Props) {
  const pct = kpi.delta_pct;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 shadow-theme-xs transition-all duration-200 hover:shadow-theme-md md:p-5 ${
        spark ? "pb-9 md:pb-10" : ""
      } ${
        emphasis
          ? "border-brand-200 bg-gradient-to-br from-brand-50 via-white to-brand-50/40 hover:border-brand-300 dark:border-brand-500/40 dark:from-brand-500/15 dark:via-white/[0.03] dark:to-brand-500/5 dark:hover:border-brand-500/60"
          : "border-gray-200 bg-gradient-to-b from-white to-gray-50/70 hover:border-gray-300 dark:border-gray-800 dark:from-white/[0.045] dark:to-white/[0.02] dark:hover:border-gray-700"
      }`}
    >
      {spark && (
        <span
          aria-hidden
          className={`pointer-events-none ${
            emphasis ? "text-brand-600 dark:text-brand-400" : "text-gray-500 dark:text-gray-400"
          }`}
        >
          <Sparkline points={spark} />
        </span>
      )}

      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/25">
            {icon}
          </span>

          {/* A null delta means the previous period was empty — print nothing.
              There is no honest percentage against nothing. */}
          {pct !== null && <DeltaPill pct={pct} title={`${format(kpi.previous)} ${basis}`} />}
        </div>

        <h4
          className={`mt-4 truncate font-bold tabular-nums tracking-tight ${
            emphasis
              ? "text-2xl text-brand-600 dark:text-brand-400 md:text-3xl"
              : "text-2xl text-gray-800 dark:text-white/90"
          }`}
          title={value}
        >
          {value}
        </h4>
        <span
          className={`mt-1 block truncate text-theme-sm ${
            emphasis
              ? "font-semibold text-brand-700 dark:text-brand-300"
              : "font-medium text-gray-600 dark:text-gray-300"
          }`}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

/** The comparison pill. A flat period is real news, but neither good nor bad. */
function DeltaPill({ pct, title }: { pct: number; title: string }) {
  const tone =
    pct === 0
      ? "bg-gray-100 text-gray-600 ring-gray-200 dark:bg-white/5 dark:text-gray-300 dark:ring-gray-700"
      : pct > 0
        ? "bg-success-50 text-success-600 ring-success-100 dark:bg-success-500/15 dark:text-success-500 dark:ring-success-500/25"
        : "bg-error-50 text-error-600 ring-error-100 dark:bg-error-500/15 dark:text-error-500 dark:ring-error-500/25";

  return (
    <span
      title={title}
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-theme-xs font-semibold tabular-nums ring-1 ${tone}`}
    >
      {pct > 0 && <ArrowUpIcon className="size-3" />}
      {pct < 0 && <ArrowDownIcon className="size-3" />}
      {signedPct(pct)}
    </span>
  );
}

export function KpiTileSkeleton() {
  return (
    // Same padding, ground and sparkline allowance as the loaded tile, or the
    // strip resizes the instant the payload lands.
    <div className="rounded-2xl border border-gray-200 bg-white p-4 pb-9 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] md:p-5 md:pb-10">
      <div className="size-10 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
      <div className="mt-4 h-7 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      <div className="mt-2 h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}
