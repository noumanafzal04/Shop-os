import PageMeta from "../../components/common/PageMeta";
import Alert from "../../components/ui/alert/Alert";
import { MetricCard, MetricCardSkeleton } from "../../common/ui/MetricCard";
import { useTenantDashboard } from "../../modules/dashboard/hooks/useDashboard";
import { useMoney } from "../../modules/shop/hooks/useShop";
import { useAuthStore } from "../../stores/authStore";

/**
 * Shop-owner / staff dashboard. Renders honest empty states while the
 * sales/inventory modules are pending — the widget contract is live.
 */
export default function ShopDashboard() {
  const { data, isLoading, isError } = useTenantDashboard();
  const user = useAuthStore((s) => s.user);

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
  );
}
