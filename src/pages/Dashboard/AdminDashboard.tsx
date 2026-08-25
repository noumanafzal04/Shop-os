import PageMeta from "../../components/common/PageMeta";
import { DashboardHero } from "../../modules/dashboard/components/DashboardHero";
import Alert from "../../components/ui/alert/Alert";
import {
  BoltIcon,
  BoxIconLine,
  CheckCircleIcon,
  GridIcon,
  GroupIcon,
  PaperPlaneIcon,
  PieChartIcon,
  ShootingStarIcon,
} from "../../icons";
import { useAdminDashboard } from "../../modules/dashboard/hooks/useDashboard";
import { ActivityPanel } from "../../modules/dashboard/components/admin/ActivityPanel";
import { BusinessTypesPanel } from "../../modules/dashboard/components/admin/BusinessTypesPanel";
import { KpiTile, KpiTileSkeleton } from "../../modules/dashboard/components/admin/KpiTile";
import { ModuleAdoptionPanel } from "../../modules/dashboard/components/admin/ModuleAdoptionPanel";
import { Panel } from "../../modules/dashboard/components/admin/Panel";
import { PlansPanel } from "../../modules/dashboard/components/admin/PlansPanel";
import { QuickActions } from "../../modules/dashboard/components/admin/QuickActions";
import { RecentPaymentsPanel } from "../../modules/dashboard/components/admin/RecentPaymentsPanel";
import { RecentTenantsPanel } from "../../modules/dashboard/components/admin/RecentTenantsPanel";
import { RevenueTrendPanel } from "../../modules/dashboard/components/admin/RevenueTrendPanel";
import { TenantGrowthPanel } from "../../modules/dashboard/components/admin/TenantGrowthPanel";
import { count, money } from "../../modules/dashboard/components/admin/format";

const ICON = "size-5";

/**
 * Platform dashboard — Super Admin & platform staff.
 *
 * Every figure comes straight off the /dashboard/admin payload. The reference
 * design also carried "Support Overview" and "System Health" blocks; the API
 * exposes neither, so they are absent rather than mocked.
 */
export default function AdminDashboard() {
  const { data, isLoading, isError } = useAdminDashboard();
  const k = data?.kpis;

  return (
    <>
      <PageMeta title="Admin | CartZe" description="Platform overview" />

      {/* Counted from the payload's own tenant block, never from the rows on
          screen — a summary that disagrees with its own table is worse than no
          summary. */}
      <DashboardHero
        eyebrow="CartZe platform"
        title="Platform Overview"
        subtitle="Tenants, subscriptions and revenue across the platform"
        icon={<GridIcon className="size-6" />}
        chips={
          data
            ? [
                { label: "Active", value: count(data.tenants.active), tone: "good" },
                { label: "Suspended", value: count(data.tenants.suspended), tone: "bad" },
                { label: "Online shops", value: count(data.tenants.online_shops) },
              ]
            : undefined
        }
        // A failed load gets nothing: three pulsing ghosts that never resolve
        // read as a hung page rather than an error.
        loadingChips={isLoading ? 3 : 0}
      />

      {isError && (
        <div className="mb-6">
          <Alert
            variant="error"
            title="Couldn't load dashboard"
            message="Check your connection and try again."
          />
        </div>
      )}

      {/* With no payload at all there is nothing honest to draw — the alert
          stands alone rather than over a page of skeletons that never resolve. */}
      {(data || isLoading) && (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
          {!k ? (
            Array.from({ length: 6 }).map((_, i) => <KpiTileSkeleton key={i} />)
          ) : (
            <>
              <KpiTile
                label="Total tenants"
                value={count(k.total_tenants.value)}
                format={count}
                basis="last month"
                kpi={k.total_tenants}
                icon={<GroupIcon className={ICON} />}
              />
              <KpiTile
                label="Active subscriptions"
                value={count(k.active_subscriptions.value)}
                format={count}
                basis="a month ago"
                kpi={k.active_subscriptions}
                icon={<CheckCircleIcon className={ICON} />}
              />
              {/* Platform staff without `billing.view` do not get the money.
                  The server omits the key rather than sending a zero, so the
                  tile disappears instead of reporting a takings of nought. */}
              {k.revenue_this_month && (
                <KpiTile
                  label="Revenue this month"
                  value={money(k.revenue_this_month.value)}
                  format={money}
                  basis="last month"
                  kpi={k.revenue_this_month}
                  icon={<PieChartIcon className={ICON} />}
                  emphasis
                  // revenue_series IS this figure, month by month.
                  spark={data?.revenue_series?.map((m) => m.total)}
                />
              )}
              <KpiTile
                label="Online orders today"
                value={count(k.online_orders_today.value)}
                format={count}
                basis="yesterday"
                kpi={k.online_orders_today}
                icon={<BoxIconLine className={ICON} />}
              />
              <KpiTile
                label="Active riders"
                value={count(k.active_riders.value)}
                format={count}
                basis="a month ago"
                kpi={k.active_riders}
                icon={<PaperPlaneIcon className={ICON} />}
              />
              <KpiTile
                label="New tenants this month"
                value={count(k.new_tenants_this_month.value)}
                format={count}
                basis="last month"
                kpi={k.new_tenants_this_month}
                icon={<ShootingStarIcon className={ICON} />}
                // tenant_growth IS this figure, month by month.
                spark={data?.tenant_growth.map((m) => m.total)}
              />
            </>
          )}
        </div>

        {/* Same rule: no revenue series means this person may not see the
            money, so the chart goes and growth takes the full width rather
            than sitting next to an empty panel. */}
        {isLoading || data?.revenue_series ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RevenueTrendPanel series={data?.revenue_series} loading={isLoading} />
            </div>
            <TenantGrowthPanel growth={data?.tenant_growth} loading={isLoading} />
          </div>
        ) : (
          <TenantGrowthPanel growth={data?.tenant_growth} loading={isLoading} />
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <BusinessTypesPanel types={data?.business_types} loading={isLoading} />
          <div className="lg:col-span-2">
            <PlansPanel plans={data?.plans} loading={isLoading} />
          </div>
        </div>

        {/* What the platform is really shipping. Since modules are assigned per
            tenant rather than sold in a bundle, nothing else on this page says
            which of them anyone uses. */}
        <ModuleAdoptionPanel modules={data?.modules} loading={isLoading} />

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <RecentTenantsPanel tenants={data?.recent_tenants} loading={isLoading} />
            {(isLoading || data?.recent_payments) && (
              <RecentPaymentsPanel payments={data?.recent_payments} loading={isLoading} />
            )}
          </div>
          <ActivityPanel activity={data?.activity} loading={isLoading} />
        </div>

        {/* Carded like every band above it, rather than trailing off into
            floating chrome at the foot of the page. */}
        <Panel title="Quick Actions" icon={<BoltIcon className="size-5" />}>
          <QuickActions />
        </Panel>
      </div>
      )}
    </>
  );
}

