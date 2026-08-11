import Badge from "../../../../components/ui/badge/Badge";
import { BoxCubeIcon } from "../../../../icons";
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
  const rows = plans ?? [];
  // The bar is each plan's share of the BIGGEST plan, not of the whole book:
  // with a long tail of bespoke deals, shares of the total are all hairlines.
  const top = Math.max(...rows.map((p) => p.active_tenants), 0);

  return (
    <Panel
      title="Plans"
      subtitle="Active tenants and revenue collected"
      icon={<BoxCubeIcon className="size-5" />}
      action={{ label: "View All", to: "/admin/plans" }}
    >
      {loading || !plans ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <Pulse className="h-4 w-28" />
              <Pulse className="mt-4 h-7 w-16" />
              <Pulse className="mt-2 h-3 w-24" />
              <Pulse className="mt-3 h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      ) : plans.length === 0 ? (
        <PanelEmpty>No plans configured yet.</PanelEmpty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {plans.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-gray-200 bg-gradient-to-b from-white to-gray-50/70 p-4 transition-colors hover:border-brand-300 dark:border-gray-800 dark:from-white/[0.04] dark:to-white/[0.02] dark:hover:border-brand-500/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold tracking-tight text-gray-800 dark:text-white/90">
                    {p.name}
                  </p>
                  <p className="text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
                    {money(p.price)} / month
                  </p>
                </div>
                {/* A bespoke deal is not a rung on the ladder; a retired plan
                    still holding tenants is an obligation, not an offer. */}
                <Badge size="sm" color={p.is_custom ? "info" : p.is_active ? "light" : "warning"}>
                  {p.is_custom ? "Custom" : p.is_active ? p.code : "Retired"}
                </Badge>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold tabular-nums tracking-tight text-gray-800 dark:text-white/90">
                    {count(p.active_tenants)}
                  </p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">active tenants</p>
                </div>
                {/* Withheld from platform staff without `billing.view`. The
                    column is dropped rather than zeroed — a zero is an answer,
                    and it would be the wrong one. */}
                {p.revenue !== undefined && (
                  <div className="text-right">
                    <p className="text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                      {money(p.revenue)}
                    </p>
                    <p className="text-theme-xs text-gray-500 dark:text-gray-400">collected</p>
                  </div>
                )}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all duration-500"
                  style={{ width: top > 0 ? `${Math.round((p.active_tenants / top) * 100)}%` : "0%" }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
