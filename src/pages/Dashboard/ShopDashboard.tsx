import PageMeta from "../../components/common/PageMeta";
import Alert from "../../components/ui/alert/Alert";
import { useTenantDashboard } from "../../modules/dashboard/hooks/useDashboard";
import { ActivityTimeline } from "../../modules/dashboard/components/shop/ActivityTimeline";
import { AttentionPanel } from "../../modules/dashboard/components/shop/AttentionPanel";
import { BranchComparison } from "../../modules/dashboard/components/shop/BranchComparison";
import { ExpenseDonut } from "../../modules/dashboard/components/shop/ExpenseDonut";
import { HighlightsRow } from "../../modules/dashboard/components/shop/HighlightsRow";
import { InventoryTiles, hasInventoryTiles } from "../../modules/dashboard/components/shop/InventoryTiles";
import { KpiRow, KpiRowSkeleton } from "../../modules/dashboard/components/shop/KpiRow";
import { PipelinePanel } from "../../modules/dashboard/components/shop/PipelinePanel";
import { QuickActions } from "../../modules/dashboard/components/shop/QuickActions";
import { RecentExpensesCard, RecentSalesCard, TableSkeleton } from "../../modules/dashboard/components/shop/RecentTables";
import { ChartSkeleton, SalesTrendChart } from "../../modules/dashboard/components/shop/SalesTrendChart";
import { EmptyPanel, SectionCard } from "../../modules/dashboard/components/shop/SectionCard";
import { useCapabilities } from "../../modules/dashboard/components/shop/capabilities";
import { useMoney } from "../../modules/shop/hooks/useShop";
import { useAuthStore } from "../../stores/authStore";
import { useUiMode } from "../../context/UiModeContext";

/**
 * Shop-owner / staff dashboard.
 *
 * Every panel is gated on the tenant's own modules, derived exactly the way
 * AppSidebar derives its nav: a books-only (finance) shop sees an expenses and
 * cashbook console with no stock, pipeline or sales panels; a services shop
 * sees no stock panels. A module the tenant doesn't have produces no card at
 * all — never an empty one — and no figure is shown that the payload didn't
 * carry.
 */
export default function ShopDashboard() {
  const { data, isLoading, isError } = useTenantDashboard();
  const user = useAuthStore((s) => s.user);
  const { mode } = useUiMode();
  const caps = useCapabilities();
  const money = useMoney();

  const basic = mode === "basic";
  // Skeleton tile count has to match what the loaded strip will render, or the
  // page jumps as the payload lands.
  const tileCount = caps.sells
    ? basic
      ? caps.keepsBooks
        ? 3
        : 2
      : caps.keepsBooks
        ? 6
        : 5
    : caps.keepsBooks
      ? basic
        ? 2
        : 4
      : 0;

  const branchName = data?.branch_scope
    ? data.branches.find((b) => b.branch_id === data.branch_scope)?.branch
    : null;

  return (
    <>
      <PageMeta title="Dashboard | ShopOS" description="Your business at a glance" />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            {user?.tenant?.business_name ?? "Dashboard"}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        {branchName && (
          <span className="rounded-full bg-brand-50 px-3 py-1 text-theme-xs font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
            {branchName} only
          </span>
        )}
      </div>

      {data?.subscription_state === "grace" && (
        <div className="mb-6">
          <Alert
            variant="warning"
            title="Subscription expired — grace period"
            message={`Everything still works until ${
              data.grace_ends_at ? new Date(data.grace_ends_at).toLocaleDateString() : "soon"
            }. Renew now to avoid read-only mode. Your data is safe.`}
          />
        </div>
      )}
      {data?.subscription_state === "read_only" && (
        <div className="mb-6">
          <Alert
            variant="error"
            title="Read-only mode"
            message="Your subscription has expired. You can view everything, but changes are blocked until renewal. No data has been lost."
          />
        </div>
      )}

      {isError && (
        <div className="mb-6">
          <Alert
            variant="error"
            title="Couldn't load dashboard"
            message="Check your connection and try again."
          />
        </div>
      )}

      {isLoading || !data ? (
        <div className="space-y-5 md:space-y-6">
          {tileCount > 0 && <KpiRowSkeleton count={tileCount} />}
          {!basic && (
            <>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 md:gap-6">
                <div className="xl:col-span-2">
                  <ChartSkeleton />
                </div>
                <ChartSkeleton height="h-[240px]" />
              </div>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 md:gap-6">
                <TableSkeleton />
                <TableSkeleton />
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5 md:space-y-6">
          <KpiRow data={data} caps={caps} money={money} compact={basic} />

          {/* Basic mode is the calm view: what needs doing, and the counters
              behind it. Charts, ledgers and history live in the full menu. */}
          {!basic && (caps.sells || caps.keepsBooks) && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 md:gap-6">
              <div className={caps.keepsBooks ? "xl:col-span-2" : "xl:col-span-3"}>
                <SalesTrendChart
                  series={data.sales_series}
                  money={money}
                  showRevenue={caps.sells}
                  showExpenses={caps.keepsBooks}
                  showProfit={caps.sells}
                />
              </div>
              {caps.keepsBooks && <ExpenseDonut breakdown={data.expense_breakdown} money={money} />}
            </div>
          )}

          <div
            className={`grid grid-cols-1 gap-5 md:gap-6 ${
              hasInventoryTiles(caps) ? "xl:grid-cols-2" : ""
            }`}
          >
            {hasInventoryTiles(caps) && <InventoryTiles data={data} caps={caps} />}
            <AttentionPanel data={data} caps={caps} />
          </div>

          {!caps.sells && !caps.keepsBooks && (
            <SectionCard title="Nothing to show yet">
              <EmptyPanel message="This shop has no selling or bookkeeping modules enabled. Ask support which modules your plan includes." />
            </SectionCard>
          )}

          {!basic && (caps.takesOrders || data.branches.length > 0) && (
            <div
              className={`grid grid-cols-1 gap-5 md:gap-6 ${
                caps.takesOrders && data.branches.length > 0 ? "xl:grid-cols-2" : ""
              }`}
            >
              {caps.takesOrders && (
                <PipelinePanel
                  pipeline={data.order_pipeline}
                  to={caps.marketplace ? "/tenant/orders" : undefined}
                />
              )}
              {data.branches.length > 0 && (
                <BranchComparison branches={data.branches} scope={data.branch_scope} money={money} />
              )}
            </div>
          )}

          {!basic && (caps.sells || caps.keepsBooks) && (
            <div
              className={`grid grid-cols-1 gap-5 md:gap-6 ${
                caps.sells && caps.keepsBooks ? "xl:grid-cols-2" : ""
              }`}
            >
              {caps.sells && (
                <RecentSalesCard
                  rows={data.recent_sales}
                  money={money}
                  to={caps.canSell ? "/tenant/sales" : undefined}
                />
              )}
              {caps.keepsBooks && (
                <RecentExpensesCard rows={data.recent_expenses} money={money} to="/tenant/expenses" />
              )}
            </div>
          )}

          {!basic && <HighlightsRow highlights={data.highlights} caps={caps} money={money} />}

          {!basic && <ActivityTimeline rows={data.activity} />}

          <QuickActions caps={caps} />
        </div>
      )}
    </>
  );
}
