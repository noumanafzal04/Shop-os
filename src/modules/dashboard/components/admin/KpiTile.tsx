import type { ReactNode } from "react";

import type { Kpi } from "../../types";
import { MetricTile, MetricTileSkeleton } from "../MetricTile";

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

/**
 * The platform console's number tile — a shell over `MetricTile`, which the
 * shop console's strip also renders.
 *
 * They were the same design written twice and had drifted on the PERCENTAGE
 * itself: this one printed "-100.43%" with a hyphen and no rounding while the
 * shop printed "−100.4%" with a typographic minus. One number, one format.
 */
export function KpiTile({ label, value, icon, kpi, basis, format, emphasis = false, spark }: Props) {
  return (
    <MetricTile
      label={label}
      value={value}
      icon={icon}
      // A null delta means the previous period was empty. `MetricTile` prints
      // nothing for it — there is no honest percentage against nothing.
      delta={kpi.delta_pct}
      deltaTitle={`${format(kpi.previous)} ${basis}`}
      emphasis={emphasis}
      spark={spark}
    />
  );
}

export function KpiTileSkeleton() {
  return <MetricTileSkeleton />;
}
