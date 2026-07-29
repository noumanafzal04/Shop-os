import PageMeta from "../../components/common/PageMeta";
import Alert from "../../components/ui/alert/Alert";
import { MetricCard, MetricCardSkeleton } from "../../common/ui/MetricCard";
import { useTenantDashboard } from "../../modules/dashboard/hooks/useDashboard";
import { useMoney } from "../../modules/shop/hooks/useShop";
import { useAuthStore } from "../../stores/authStore";
import { useUiMode } from "../../context/UiModeContext";

/**
 * Shop-owner / staff dashboard. Renders honest empty states while the
 * sales/inventory modules are pending — the widget contract is live.
 */
export default function ShopDashboard() {
  const { data, isLoading, isError } = useTenantDashboard();
  const user = useAuthStore((s) => s.user);
  const { mode } = useUiMode();

  const money = useMoney();

  return (
    <>
      <PageMeta title="Dashboard | ShopOS" description="Your business at a glance" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
          {user?.tenant?.business_name ?? "Dashboard"}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Today's overview
        </p>
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

      {mode === "basic" ? (
        // Basic: the three numbers a shopkeeper checks each day.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6">
          {isLoading ? (
            <>
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </>
          ) : data ? (
            <>
              <MetricCard label="Today's Sales" value={data.today.sales_count} hint="transactions" />
              <MetricCard label="Revenue" value={money(data.today.revenue)} />
              <MetricCard label="Low Stock Alerts" value={data.low_stock_count} />
            </>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-6">
            {isLoading ? (
              <>
                <MetricCardSkeleton />
                <MetricCardSkeleton />
                <MetricCardSkeleton />
                <MetricCardSkeleton />
              </>
            ) : data ? (
              <>
                <MetricCard label="Today's Sales" value={data.today.sales_count} hint="transactions" />
                <MetricCard label="Revenue" value={money(data.today.revenue)} />
                <MetricCard label="Expenses" value={money(data.today.expenses)} />
                <MetricCard label="Profit" value={money(data.today.profit)} />
              </>
            ) : null}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6">
            {isLoading ? (
              <>
                <MetricCardSkeleton />
                <MetricCardSkeleton />
                <MetricCardSkeleton />
              </>
            ) : data ? (
              <>
                <MetricCard
                  label="Products"
                  value={data.products_count}
                  hint={data.products_count === 0 ? "Add your first product soon" : undefined}
                />
                <MetricCard label="Low Stock Alerts" value={data.low_stock_count} />
                {data.expiring_soon_count > 0 && (
                  <MetricCard
                    label="Expiring Soon"
                    value={data.expiring_soon_count}
                    hint="batches within 30 days — check Inventory"
                  />
                )}
                {data.online_shop_enabled ? (
                  <MetricCard
                    label="Pending Orders"
                    value={data.pending_orders}
                    hint={`${data.pending_reservations} reservations waiting`}
                  />
                ) : (
                  <MetricCard
                    label="Online Shop"
                    value="Off"
                    hint="Contact support to enable marketplace selling"
                  />
                )}
              </>
            ) : null}
          </div>
        </>
      )}

      {/* HQ comparison — today's sales per branch (multi-branch shops only). */}
      {data && data.branches.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between px-5 py-4">
            <h3 className="font-semibold text-gray-800 dark:text-white/90">Today by branch</h3>
            <span className="text-theme-xs uppercase tracking-wide text-gray-400">
              {data.branch_scope ? "Focused view" : "All branches"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-t border-gray-200 text-left text-theme-xs uppercase text-gray-400 dark:border-gray-800">
                  <th className="px-5 py-3 font-medium">Branch</th>
                  <th className="px-5 py-3 text-right font-medium">Sales</th>
                  <th className="px-5 py-3 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.branches.map((b) => (
                  <tr
                    key={b.branch_id}
                    className={b.branch_id === data.branch_scope ? "bg-brand-50/50 dark:bg-brand-500/5" : ""}
                  >
                    <td className="px-5 py-3 font-medium text-gray-800 dark:text-white/90">{b.branch}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{b.sales_count}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-gray-800 dark:text-white/90">{money(b.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
