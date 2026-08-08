import { GridIcon } from "../../../../icons";
import type { TenantDashboard } from "../../types";
import { SectionCard } from "./SectionCard";

interface Props {
  branches: TenantDashboard["branches"];
  /** The branch these dashboard figures are focused on, if any. */
  scope: string | null;
  money: (n: string | number) => string;
  /** May this person open the locations screen? Only the "Manage" link needs it. */
  canManage?: boolean;
}

/**
 * HQ view: today's takings side by side. The bar is each branch's share of the
 * busiest branch, so the comparison is readable without a second axis.
 */
export function BranchComparison({ branches, scope, money, canManage = true }: Props) {
  const top = Math.max(...branches.map((b) => b.revenue), 0);

  return (
    <SectionCard
      title="Today by branch"
      subtitle={scope ? "Figures above are focused on one branch" : "All branches"}
      icon={<GridIcon className="size-5" />}
      to={canManage ? "/tenant/branches" : undefined}
      toLabel="Manage"
    >
      <ul className="space-y-4">
        {branches.map((branch) => {
          const focused = branch.branch_id === scope;

          return (
            <li key={branch.branch_id}>
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={`flex min-w-0 items-center gap-2 truncate text-theme-sm font-medium ${
                    focused ? "text-brand-600 dark:text-brand-400" : "text-gray-800 dark:text-white/90"
                  }`}
                >
                  <span className="truncate">{branch.branch}</span>
                  {/* The scoped branch is the one every figure above belongs to;
                      saying so here is cheaper than the reader inferring it. */}
                  {focused && (
                    <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-theme-xs font-semibold text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/25">
                      In focus
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-theme-sm tabular-nums text-gray-500 dark:text-gray-400">
                  {branch.sales_count} {branch.sales_count === 1 ? "sale" : "sales"} ·{" "}
                  <span className="font-semibold text-gray-800 dark:text-white/90">
                    {money(branch.revenue)}
                  </span>
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    focused
                      ? "bg-gradient-to-r from-brand-500 to-brand-400"
                      : "bg-gradient-to-r from-brand-600/70 to-brand-500/70"
                  }`}
                  style={{ width: top > 0 ? `${Math.round((branch.revenue / top) * 100)}%` : "0%" }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
