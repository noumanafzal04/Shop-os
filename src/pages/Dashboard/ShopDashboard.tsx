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
import { MoneyPanel, hasMoneyPanel } from "../../modules/dashboard/components/shop/MoneyPanel";
import { PipelinePanel } from "../../modules/dashboard/components/shop/PipelinePanel";
import { QuickActions } from "../../modules/dashboard/components/shop/QuickActions";
import { RecentExpensesCard, RecentSalesCard, TableSkeleton } from "../../modules/dashboard/components/shop/RecentTables";
import { ChartSkeleton, SalesTrendChart } from "../../modules/dashboard/components/shop/SalesTrendChart";
import { EmptyPanel, PanelSkeleton, SectionCard } from "../../modules/dashboard/components/shop/SectionCard";
import { BayPanel, DispensingPanel, FloorPanel } from "../../modules/dashboard/components/shop/TradePanel";
import { useCapabilities } from "../../modules/dashboard/components/shop/capabilities";
import { useMoney } from "../../modules/shop/hooks/useShop";
import { useAuthStore } from "../../stores/authStore";
import { useUiMode } from "../../context/UiModeContext";

/** Two letters off the shop's own name — a mark, not an avatar upload. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "S";

  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

/** Reads the shop's clock, not the payload — a greeting is not a figure. */
function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";

  return "Good evening";
}

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

  const shopName = user?.tenant?.business_name ?? "Dashboard";
  const now = new Date();

  return (
    <>
      <PageMeta title="Dashboard | ShopOS" description="Your business at a glance" />

      {/* A header band rather than a bare title: this page is a stack of white
          cards, and without one deliberate plate at the top the first KPI tile
          becomes the page's masthead by accident. The wash is the tenant's own
          brand ramp, which is the only colour on the page that is theirs. */}
      <header className="relative mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] md:mb-6 sm:p-6">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-500/20"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-theme-xl font-bold text-white shadow-theme-md sm:size-14">
              {initials(shopName)}
            </span>
            <div className="min-w-0">
              <p className="text-theme-xs font-medium uppercase tracking-wider text-brand-600 dark:text-brand-400">
                {greeting(now.getHours())}
              </p>
              <h2 className="mt-0.5 truncate text-xl font-bold tracking-tight text-gray-800 dark:text-white/90 sm:text-2xl">
                {shopName}
              </h2>
              <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">
                {now.toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
          {branchName && (
            <span className="flex items-center gap-2 rounded-full bg-brand-50 px-3.5 py-1.5 text-theme-xs font-semibold text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/25">
              <span className="size-1.5 rounded-full bg-brand-500" />
              {branchName} only
            </span>
          )}
        </div>
      </header>

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
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 md:gap-6">
              <div className="xl:col-span-2">
                <ChartSkeleton />
              </div>
              <ChartSkeleton height="h-[240px]" />
            </div>
          )}
          {/* Attention needed carries no module gate, so it is the one panel the
              loaded page ALWAYS draws — in both modes. Leaving it out of the
              skeleton is what made the page jump on arrival. */}
          <PanelSkeleton />
          {!basic && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 md:gap-6">
              <TableSkeleton />
              <TableSkeleton />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5 md:space-y-6">
          <KpiRow data={data} caps={caps} money={money} compact={basic} />

          {/* The trade's own panel, directly under the money and above the
              charts — and in BOTH modes. A restaurant at eight in the evening
              is not reading a 7-day trend, and what is on the pass right now
              outranks everything below it. Absent, never empty: the server
              sends null for a shop that is not this trade. */}
          {data.floor && <FloorPanel floor={data.floor} caps={caps} />}
          {data.dispensing && <DispensingPanel dispensing={data.dispensing} money={money} />}
          {data.bay && <BayPanel bay={data.bay} money={money} canVisit={caps.visit("/tenant/workshop")} />}

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

          {/* Shown in BOTH modes: "who owes me" and "is the day closed" are
              daily questions for a corner shop, not advanced reporting. */}
          {hasMoneyPanel(data, caps) && <MoneyPanel data={data} caps={caps} money={money} />}

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
                  to={caps.marketplace && caps.visit("/tenant/orders") ? "/tenant/orders" : undefined}
                />
              )}
              {data.branches.length > 0 && (
                <BranchComparison
                  branches={data.branches}
                  scope={data.branch_scope}
                  money={money}
                  // The comparison is worth reading either way; managing the
                  // locations is configuration.
                  canManage={caps.visit("/tenant/branches")}
                />
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
                  to={caps.canSell && caps.visit("/tenant/sales") ? "/tenant/sales" : undefined}
                />
              )}
              {caps.keepsBooks && (
                <RecentExpensesCard
                  rows={data.recent_expenses}
                  money={money}
                  to={caps.visit("/tenant/expenses") ? "/tenant/expenses" : undefined}
                />
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
