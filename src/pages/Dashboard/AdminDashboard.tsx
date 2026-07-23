import PageMeta from "../../components/common/PageMeta";
import Alert from "../../components/ui/alert/Alert";
import Badge from "../../components/ui/badge/Badge";
import { MetricCard, MetricCardSkeleton } from "../../common/ui/MetricCard";
import { useAdminDashboard } from "../../modules/dashboard/hooks/useDashboard";

/**
 * Platform dashboard — Super Admin & platform staff.
 */
export default function AdminDashboard() {
  const { data, isLoading, isError } = useAdminDashboard();

  return (
    <>
      <PageMeta title="Admin | ShopOS" description="Platform overview" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
          Platform Overview
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Tenants across the platform
        </p>
      </div>

      {isError && (
        <div className="mb-6">
          <Alert
            variant="error"
            title="Couldn't load dashboard"
            message="Check your connection and try again."
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5 md:gap-6">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : data ? (
          <>
            <MetricCard label="Total Tenants" value={data.tenants.total} />
            <MetricCard label="Active" value={data.tenants.active} />
            <MetricCard label="Suspended" value={data.tenants.suspended} />
            <MetricCard label="Online Shops" value={data.tenants.online_shops} />
            <MetricCard label="New This Month" value={data.tenants.new_this_month} />
          </>
        ) : null}
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">
            Recent Tenants
          </h3>
        </div>
        <div className="p-6">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              ))}
            </div>
          ) : data && data.recent_tenants.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-theme-xs text-gray-500 dark:text-gray-400">
                    <th className="pb-3 font-medium">Business</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Plan</th>
                    <th className="pb-3 font-medium">Online</th>
                    <th className="pb-3 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.recent_tenants.map((t) => (
                    <tr key={t.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                      <td className="py-3 font-medium">{t.business_name}</td>
                      <td className="py-3">
                        <Badge size="sm" color={t.status === "active" ? "success" : "error"}>
                          {t.status}
                        </Badge>
                      </td>
                      <td className="py-3">{t.plan?.name ?? "—"}</td>
                      <td className="py-3">
                        <Badge size="sm" color={t.online_shop_enabled ? "success" : "light"}>
                          {t.online_shop_enabled ? "Yes" : "No"}
                        </Badge>
                      </td>
                      <td className="py-3">{new Date(t.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No tenants yet — create the first one from Tenants.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
