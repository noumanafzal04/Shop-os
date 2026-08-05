import type { TenantDashboard } from "../../types";
import { SectionCard } from "./SectionCard";

interface Props {
  branches: TenantDashboard["branches"];
  /** The branch these dashboard figures are focused on, if any. */
  scope: string | null;
  money: (n: string | number) => string;
}

/**
 * HQ view: today's takings side by side. The bar is each branch's share of the
 * busiest branch, so the comparison is readable without a second axis.
 */
export function BranchComparison({ branches, scope, money }: Props) {
  const top = Math.max(...branches.map((b) => b.revenue), 0);

  return (
    <SectionCard
      title="Today by branch"
      subtitle={scope ? "Figures above are focused on one branch" : "All branches"}
      to="/tenant/branches"
      toLabel="Manage"
    >
      <ul className="space-y-4">
        {branches.map((branch) => (
          <li key={branch.branch_id}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={`truncate text-theme-sm font-medium ${
                  branch.branch_id === scope
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-gray-800 dark:text-white/90"
                }`}
              >
                {branch.branch}
              </span>
              <span className="shrink-0 text-theme-sm tabular-nums text-gray-500 dark:text-gray-400">
                {branch.sales_count} {branch.sales_count === 1 ? "sale" : "sales"} ·{" "}
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {money(branch.revenue)}
                </span>
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: top > 0 ? `${Math.round((branch.revenue / top) * 100)}%` : "0%" }}
              />
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
