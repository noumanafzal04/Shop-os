import PageMeta from "../../components/common/PageMeta";
import { DashboardHero } from "../../modules/dashboard/components/DashboardHero";
import { PeriodBar } from "../../modules/dashboard/components/PeriodBar";
import Alert from "../../components/ui/alert/Alert";
import { fromIsoDate, isSameRange, resolveRange, type DateRange } from "../../components/ui/filters";
import {
  BoltIcon,
  BoxIconLine,
  CheckCircleIcon,
  GridIcon,
  GroupIcon,
  PaperPlaneIcon,
  PieChartIcon,
  ShootingStarIcon,
  UserCircleIcon,
} from "../../icons";
import { useAdminDashboard } from "../../modules/dashboard/hooks/useDashboard";
import { useDashboardPeriod } from "../../modules/dashboard/hooks/useDashboardPeriod";
import { comparedWith } from "../../modules/dashboard/period";
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
import { PRODUCT } from "../../common/brand";

const ICON = "size-5";

/**
 * Platform dashboard — Super Admin & platform staff.
 *
 * Every figure comes straight off the /dashboard/admin payload. The reference
 * design also carried "Support Overview" and "System Health" blocks; the API
 * exposes neither, so they are absent rather than mocked.
 */
/**
 * The platform's own date, before the server has said what it is.
 *
 * Platform figures are cut on the server's calendar (UTC), not the laptop's —
 * in Pakistan the two are different dates for the first five hours of every
 * day. Only used until the first answer arrives; after that `period.today` is
 * the server's own word for it.
 */
function platformToday(): Date {
  const now = new Date();

  return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export default function AdminDashboard() {
  // THE PERIOD. With nothing pinned the SERVER says which it is — the seven
  // days ending today, by its own clock — and this page shows what it said.
  // A single day of a platform paid by the month is mostly noughts.
  const { pinned, pin } = useDashboardPeriod();
  const { data, isLoading, isError, isPlaceholderData } = useAdminDashboard(pinned);
  const today = data ? fromIsoDate(data.period.today) : platformToday();
  const opensOn = resolveRange("last_7", today);
  const asked: DateRange = pinned ?? (data ? { from: data.period.from, to: data.period.to } : opensOn);
  const ask = (next: DateRange) => pin(isSameRange(next, opensOn) ? null : next);

  const k = data?.kpis;
  const p = data?.in_period;
  // "Rs 2,000 yesterday" · "Rs 2,000 in 26 Sep – 2 Oct" — what a pill's
  // percentage is a percentage OF, on hover.
  const against = data ? comparedWith(data.period) : "";
  const basis = /\d/.test(against) ? `in ${against}` : against;

  return (
    <>
      <PageMeta title="Admin" description="Platform overview" />

      {/* Counted from the payload's own tenant block, never from the rows on
          screen — a summary that disagrees with its own table is worse than no
          summary. */}
      <DashboardHero
        eyebrow={`${PRODUCT.name} platform`}
        title="Platform Overview"
        subtitle="Tenants, subscriptions and revenue across the platform"
        icon={<GridIcon className="size-6" />}
        chips={
          data
            ? [
                { label: "Active", value: count(data.tenants.active), tone: "good" },
                { label: "Suspended", value: count(data.tenants.suspended), tone: "bad" },
                { label: "Online shops", value: count(data.tenants.online_shops) },
                // Only when somebody is actually trying it. A permanent "Demos
                // 0" is padding; a number here is a landing page working.
                ...(data.tenants.demos > 0
                  ? [{ label: "Trying it", value: count(data.tenants.demos) }]
                  : []),
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
        {/* WHAT HAPPENED, in the period at its head. Flows only — money
            collected, who joined, what was ordered — each beside the same
            count for the period it is set against. */}
        <div className="space-y-4">
          <PeriodBar range={asked} onChange={ask} today={today} told={data?.period} busy={isPlaceholderData} />

          <div
            data-testid="in-period"
            aria-busy={isPlaceholderData}
            className={`grid grid-cols-2 gap-4 transition-opacity md:gap-6 ${
              // One tile fewer for somebody who may not see the money, and the
              // row is cut to fit rather than left with a hole at the end.
              !p || p.revenue ? "lg:grid-cols-4" : "lg:grid-cols-3"
            } ${isPlaceholderData ? "opacity-60" : ""}`}
          >
            {!p ? (
              Array.from({ length: 4 }).map((_, i) => <KpiTileSkeleton key={i} />)
            ) : (
              <>
                {/* Platform staff without `billing.view` do not get the money.
                    The server omits the key rather than sending a zero, so the
                    tile disappears instead of reporting a takings of nought. */}
                {p.revenue && (
                  <KpiTile
                    label="Revenue collected"
                    value={money(p.revenue.value)}
                    format={money}
                    basis={basis}
                    kpi={p.revenue}
                    icon={<PieChartIcon className={ICON} />}
                    featured
                    caption={
                      p.payments === undefined
                        ? undefined
                        : p.payments === 0
                          ? "No payments recorded"
                          : `${count(p.payments)} ${p.payments === 1 ? "payment" : "payments"}`
                    }
                  />
                )}
                <KpiTile
                  label="New tenants"
                  value={count(p.new_tenants.value)}
                  format={count}
                  basis={basis}
                  kpi={p.new_tenants}
                  icon={<ShootingStarIcon className={ICON} />}
                  // A shop that began as a demo and was kept is the landing
                  // page doing its job, and worth saying apart.
                  caption={p.kept_from_demo > 0 ? `${count(p.kept_from_demo)} kept from a demo` : undefined}
                />
                <KpiTile
                  label="Online orders"
                  value={count(p.online_orders.value)}
                  format={count}
                  basis={basis}
                  kpi={p.online_orders}
                  icon={<BoxIconLine className={ICON} />}
                  caption={p.orders_value > 0 ? `Worth ${money(p.orders_value)} to the shops` : undefined}
                />
                <KpiTile
                  label="New customers"
                  value={count(p.new_customers.value)}
                  format={count}
                  basis={basis}
                  kpi={p.new_customers}
                  icon={<UserCircleIcon className={ICON} />}
                  caption="Signed up to buy"
                />
              </>
            )}
          </div>
        </div>

        {/* WHAT THE PLATFORM IS — now, whatever period is being read above.
            Each is set against where it stood a month ago. */}
        <div className="space-y-3">
          <h3 className="text-theme-xs font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
            Right now
          </h3>
          <div data-testid="right-now" className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6">
            {!k ? (
              Array.from({ length: 3 }).map((_, i) => <KpiTileSkeleton key={i} />)
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
                <KpiTile
                  label="Active riders"
                  value={count(k.active_riders.value)}
                  format={count}
                  basis="a month ago"
                  kpi={k.active_riders}
                  icon={<PaperPlaneIcon className={ICON} />}
                />
              </>
            )}
          </div>
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

