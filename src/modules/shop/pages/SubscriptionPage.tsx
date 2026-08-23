import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import { useSubscription } from "../hooks/useShop";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

const STATE: Record<string, { label: string; color: "success" | "warning" | "error" }> = {
  active: { label: "Active", color: "success" },
  grace: { label: "Grace period", color: "warning" },
  read_only: { label: "Expired — read only", color: "error" },
};

const MODULE_LABEL: Record<string, string> = {
  pos: "POS",
  expenses: "Expense & Income",
  marketplace: "Online Commerce",
};

/**
 * The shop's own subscription view: plan, module bundle, live usage vs the
 * effective limits, and payment history. Read-only — upgrades and limit
 * extensions go through the platform (contact support).
 */
export default function SubscriptionPage() {
  const sub = useSubscription();
  const data = sub.data;

  if (sub.isLoading || !data) {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  }

  const state = STATE[data.state] ?? STATE.active;
  const meteredUsage = data.limits_usage.filter((u) => u.enforced || !u.unlimited);

  return (
    <>
      <PageMeta title="Subscription | CartZe" description="Your plan and usage" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Subscription</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Your plan, usage and payments. To upgrade or extend a limit, contact support.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Current plan */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-2 flex items-start justify-between">
            <h3 className="font-semibold text-gray-800 dark:text-white/90">Current plan</h3>
            <Badge size="sm" color={state.color}>{state.label}</Badge>
          </div>

          {data.plan === null ? (
            <p className="py-4 text-sm text-gray-500 dark:text-gray-400">
              No plan assigned yet — no catalog ceiling and no billing period. The platform team
              will set your plan up.
            </p>
          ) : (
            <>
              <p className="text-2xl font-bold text-gray-800 dark:text-white/90">
                {data.plan.name}
              </p>
              <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                {money(data.plan.price)} / {data.plan.billing_period_months} mo
              </p>
              {data.subscription_ends_at && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {data.state === "active" ? "Renews by " : "Expired "}
                  <span className="font-medium">
                    {new Date(data.subscription_ends_at).toLocaleDateString()}
                  </span>
                </p>
              )}
              {data.state === "grace" && data.grace_ends_at && (
                <p className="mt-1 text-theme-xs text-warning-600">
                  Renew before {new Date(data.grace_ends_at).toLocaleDateString()} to avoid
                  read-only mode. Your data is always safe.
                </p>
              )}
              {data.state === "read_only" && (
                <p className="mt-1 text-theme-xs text-error-500">
                  Writes are paused until renewal — nothing has been deleted.
                </p>
              )}
            </>
          )}

          {/* What the shop can DO is separate from what it pays. Showing the
              modules inside the plan card implied the plan granted them — it
              doesn't, and a renewal cannot take one away. */}
          <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
            <p className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">
              What your shop runs
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(MODULE_LABEL)
                .filter(([key]) => data.modules[key])
                .map(([key, label]) => (
                  <Badge key={key} size="sm" color="info">{label}</Badge>
                ))}
            </div>
            <p className="mt-2 text-theme-xs text-gray-400">
              Set for your business by the platform team — changing plan doesn't change these.
            </p>
          </div>
        </div>

        {/* Usage vs limits */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Usage</h3>
          {meteredUsage.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No limits on your plan — everything is unlimited.
            </p>
          ) : (
            <div className="space-y-4">
              {meteredUsage.map((u) => {
                const pct = u.limit && u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
                const bar = pct >= 100 ? "bg-error-500" : pct >= 80 ? "bg-warning-500" : "bg-brand-500";
                return (
                  <div key={u.key}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="capitalize text-gray-700 dark:text-gray-300">{u.label}</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {u.used.toLocaleString()}{" / "}
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          {u.unlimited ? "∞" : u.limit?.toLocaleString()}
                        </span>
                      </span>
                    </div>
                    {!u.unlimited && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Payment history */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Payments</h3>
          {data.payments.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No payments recorded yet.
            </p>
          ) : (
            <div className="space-y-3">
              {data.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-gray-100 pb-2 text-sm last:border-0 dark:border-gray-800">
                  <div>
                    <p className="text-gray-700 dark:text-gray-300">{p.plan_name}</p>
                    <p className="text-theme-xs text-gray-400">
                      {p.period_start} → {p.period_end}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-800 dark:text-white/90">{money(p.amount)}</p>
                    <p className="text-theme-xs capitalize text-gray-400">{p.method.replace("_", " ")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
