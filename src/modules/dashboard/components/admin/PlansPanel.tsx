import Badge from "../../../../components/ui/badge/Badge";
import type { AdminDashboard } from "../../types";
import { Panel, PanelEmpty, Pulse } from "./Panel";
import { count, money } from "./format";

interface Props {
  plans?: AdminDashboard["plans"];
  loading?: boolean;
}

/**
 * Per-plan uptake beside the money that plan has taken. Revenue is attributed
 * to the plan each payment was for, so it does not move when a tenant upgrades.
 */
export function PlansPanel({ plans, loading = false }: Props) {
  return (
    <Panel title="Plans" subtitle="Active tenants and revenue collected" action={{ label: "View All", to: "/admin/plans" }}>
      {loading || !plans ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <Pulse className="h-4 w-28" />
              <Pulse className="mt-4 h-7 w-16" />
              <Pulse className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : plans.length === 0 ? (
        <PanelEmpty>No plans configured yet.</PanelEmpty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {plans.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-gray-800 dark:text-white/90">{p.name}</p>
                <Badge size="sm" color="light">
                  {p.code}
                </Badge>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xl font-bold tabular-nums text-gray-800 dark:text-white/90">
                    {count(p.active_tenants)}
                  </p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">active tenants</p>
                </div>
                <div className="text-right">
                  <p className="text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                    {money(p.revenue)}
                  </p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">collected</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
