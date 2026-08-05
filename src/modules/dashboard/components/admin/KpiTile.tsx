import type { ReactNode } from "react";
import Badge from "../../../../components/ui/badge/Badge";
import { ArrowDownIcon, ArrowUpIcon } from "../../../../icons";
import type { Kpi } from "../../types";
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
}

export function KpiTile({ label, value, icon, kpi, basis, format, emphasis = false }: Props) {
  const pct = kpi.delta_pct;

  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-theme-xs dark:bg-white/[0.03] md:p-5 ${
        emphasis
          ? "border-brand-500 dark:border-brand-500/60"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
          {icon}
        </span>

        {/* A null delta means the previous period was empty — print nothing. */}
        {pct !== null && (
          <span title={`${format(kpi.previous)} ${basis}`}>
            <Badge size="sm" color={pct === 0 ? "light" : pct > 0 ? "success" : "error"}>
              {pct > 0 && <ArrowUpIcon />}
              {pct < 0 && <ArrowDownIcon />}
              {signedPct(pct)}
            </Badge>
          </span>
        )}
      </div>

      <h4
        className={`mt-4 text-2xl font-bold tabular-nums ${
          emphasis ? "text-brand-500 dark:text-brand-400" : "text-gray-800 dark:text-white/90"
        }`}
      >
        {value}
      </h4>
      <span className="mt-1 block text-theme-xs text-gray-500 dark:text-gray-400">{label}</span>
    </div>
  );
}

export function KpiTileSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] md:p-5">
      <div className="h-10 w-10 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
      <div className="mt-4 h-7 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      <div className="mt-2 h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}
