import { Link } from "react-router";

import { DocsIcon, TableIcon } from "../../../../icons";
import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { SectionCard } from "./SectionCard";
import { StatTile as Stat } from "./StatTile";

/**
 * The floor, right now.
 *
 * Everything else on this dashboard is a "today" figure. This is the only panel
 * that answers "what is happening this minute", because that is the only
 * question a restaurant has at eight in the evening: how many tables are sat,
 * whose bill is still running, and what is stacking up on the pass.
 *
 * `kot_ready` is separated from `kot_waiting` deliberately. Food still cooking
 * is the kitchen's problem and it is under control. Food sitting under the lamp
 * is nobody's problem yet — and it is the one going cold, so it is the number
 * that turns red.
 */
export function FloorPanel({ floor, caps }: { floor: NonNullable<TenantDashboard["floor"]>; caps: Capabilities }) {
  const free = Math.max(0, floor.tables - floor.occupied);
  const canOpenFloor = caps.visit("/tenant/dine-in");
  const canOpenKitchen = caps.visit("/tenant/kitchen");

  return (
    <SectionCard
      title="On the floor"
      subtitle="Right now, not today"
      icon={<TableIcon className="size-5" />}
      to={canOpenFloor ? "/tenant/dine-in" : undefined}
      toLabel="Floor plan"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Tables sat"
          value={floor.tables > 0 ? `${floor.occupied}/${floor.tables}` : "—"}
          caption={floor.tables > 0 ? `${free} free` : "No tables set up yet"}
          tone={floor.tables > 0 && floor.occupied === floor.tables ? "warning" : "brand"}
        />
        <Stat
          label="Bills running"
          value={floor.open_tabs.toLocaleString()}
          caption={floor.open_tabs > floor.occupied ? "includes takeaway" : undefined}
          tone={floor.open_tabs > 0 ? "brand" : "gray"}
        />
        <Stat
          label="In the kitchen"
          value={floor.kot_waiting.toLocaleString()}
          caption="still cooking"
          tone={floor.kot_waiting > 0 ? "warning" : "gray"}
        />
        <Stat
          label="On the pass"
          value={floor.kot_ready.toLocaleString()}
          caption={floor.kot_ready > 0 ? "waiting to be run" : "nothing waiting"}
          tone={floor.kot_ready > 0 ? "error" : "success"}
        />
      </div>
      {canOpenKitchen && floor.kot_ready > 0 && (
        <Link
          to="/tenant/kitchen"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-theme-sm font-semibold text-brand-600 ring-1 ring-brand-100 transition-colors hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/25 dark:hover:bg-brand-500/25"
        >
          Open the kitchen screen →
        </Link>
      )}
    </SectionCard>
  );
}

/**
 * Today's prescription trade.
 *
 * A medical store's day is two businesses sharing a counter: over-the-counter
 * sales, and the scripts it is answerable for. The dashboard counted them as
 * one, so the single figure a pharmacist would be asked to produce existed
 * nowhere in the product.
 */
export function DispensingPanel({
  dispensing,
  money,
}: {
  dispensing: NonNullable<TenantDashboard["dispensing"]>;
  money: (n: string | number) => string;
}) {
  return (
    <SectionCard
      title="Dispensed today"
      subtitle="Against a prescription, apart from counter trade"
      icon={<DocsIcon className="size-5" />}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Prescriptions"
          value={dispensing.rx_sales.toLocaleString()}
          tone={dispensing.rx_sales > 0 ? "brand" : "gray"}
        />
        <Stat label="Rx takings" value={money(dispensing.rx_revenue)} tone="success" />
        <Stat
          label="Prescribers"
          value={dispensing.prescribers.toLocaleString()}
          caption={dispensing.prescribers > 0 ? "distinct doctors today" : undefined}
          tone="gray"
        />
      </div>
    </SectionCard>
  );
}
