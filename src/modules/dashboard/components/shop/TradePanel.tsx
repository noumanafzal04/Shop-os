import { Link } from "react-router";

import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { SectionCard } from "./SectionCard";

type Tone = "brand" | "success" | "warning" | "error" | "gray";

const TILE: Record<Tone, string> = {
  brand: "bg-brand-50 dark:bg-brand-500/10",
  success: "bg-success-50 dark:bg-success-500/10",
  warning: "bg-warning-50 dark:bg-warning-500/10",
  error: "bg-error-50 dark:bg-error-500/10",
  gray: "bg-gray-50 dark:bg-white/[0.03]",
};

const NUMBER: Record<Tone, string> = {
  brand: "text-brand-600 dark:text-brand-400",
  success: "text-success-600 dark:text-success-500",
  warning: "text-warning-600 dark:text-warning-500",
  error: "text-error-600 dark:text-error-500",
  gray: "text-gray-800 dark:text-white/90",
};

function Stat({ label, value, caption, tone }: { label: string; value: string; caption?: string; tone: Tone }) {
  return (
    <div className={`rounded-xl p-4 ${TILE[tone]}`}>
      <p className={`text-2xl font-bold tabular-nums ${NUMBER[tone]}`}>{value}</p>
      <p className="mt-1 text-theme-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
      {caption && <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{caption}</p>}
    </div>
  );
}

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
          className="mt-3 inline-flex text-theme-sm font-medium text-brand-500 hover:text-brand-600"
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
    <SectionCard title="Dispensed today" subtitle="Against a prescription, apart from counter trade">
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
